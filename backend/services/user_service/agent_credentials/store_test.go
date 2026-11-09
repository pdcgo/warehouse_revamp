package agent_credentials_test

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/agent_credentials"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

const (
	redirect = "https://chatgpt.com/connector/oauth/callback"
	verifier = "a-verifier-that-is-long-enough-to-be-a-real-pkce-verifier-0123456789"
)

func challengeOf(v string) string {
	sum := sha256.Sum256([]byte(v))

	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func person(t *testing.T, db *gorm.DB) uint64 {
	t.Helper()

	u := user_service_models.User{Username: "agent-owner", Email: "agent-owner@x.local"}

	err := db.Create(&u).Error
	if err != nil {
		t.Fatalf("user: %v", err)
	}

	return u.ID
}

// connected registers a client, mints a code for the person and team, and trades it — the whole OAuth, in store calls.
func connected(t *testing.T, store *agent_credentials.Store, userID, teamID uint64) (string, *user_service_models.AgentCredential) {
	t.Helper()

	ctx := context.Background()

	client, err := store.RegisterClient(ctx, "ChatGPT", []string{redirect})
	if err != nil {
		t.Fatalf("register: %v", err)
	}

	code, err := store.MintCode(ctx, agent_credentials.CodeGrant{
		ClientID:      client.ClientID,
		RedirectURI:   redirect,
		CodeChallenge: challengeOf(verifier),
		UserID:        userID,
		TeamID:        teamID,
		Name:          "ChatGPT, Heri's laptop",
	})
	if err != nil {
		t.Fatalf("mint: %v", err)
	}

	token, credential, err := store.Exchange(ctx, code, client.ClientID, redirect, verifier)
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}

	return token, credential
}

// THE WHOLE CONNECT: the credential is the agent's own — named, the team picked, 90 days — and its bearer reads.
func TestStore_AConnectMintsTheAgentsOwnCredential(t *testing.T) {
	db := san_testdb.DB(t)
	store := agent_credentials.NewStore(db)
	userID := person(t, db)

	token, credential := connected(t, store, userID, 5)

	if !access_interceptors.IsAgentToken(token) {
		t.Fatalf("bearer %q is not marked an agent's", token)
	}

	if credential.Name != "ChatGPT, Heri's laptop" || credential.TeamID != 5 || credential.ClientName != "ChatGPT" {
		t.Fatalf("credential = %+v, want the name, team 5 and the client's name", credential)
	}

	if life := credential.ExpiresAt.Sub(credential.CreatedAt); life != agent_credentials.Lifetime {
		t.Fatalf("lifetime = %v, want 90 days", life)
	}

	grant, err := store.VerifyAgent(context.Background(), token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}

	if grant.UserID != userID || grant.TeamID != 5 || grant.CredentialID != credential.ID {
		t.Fatalf("grant = %+v, want person %d, team 5, credential %d", grant, userID, credential.ID)
	}

	var stored user_service_models.AgentCredential

	db.First(&stored, credential.ID)

	if strings.Contains(stored.TokenHash, token) || stored.TokenHash == token {
		t.Fatal("the bearer is stored in the clear")
	}
}

// A CODE IS SPENT ONCE — and a wrong verifier spends it too, so it cannot be retried.
func TestStore_ACodeIsSpentOnce(t *testing.T) {
	db := san_testdb.DB(t)
	store := agent_credentials.NewStore(db)
	userID := person(t, db)
	ctx := context.Background()

	client, _ := store.RegisterClient(ctx, "Claude", []string{redirect})
	grant := agent_credentials.CodeGrant{
		ClientID: client.ClientID, RedirectURI: redirect, CodeChallenge: challengeOf(verifier),
		UserID: userID, TeamID: 5, Name: "Claude",
	}

	code, _ := store.MintCode(ctx, grant)

	_, _, err := store.Exchange(ctx, code, client.ClientID, redirect, verifier)
	if err != nil {
		t.Fatalf("first exchange: %v", err)
	}

	_, _, err = store.Exchange(ctx, code, client.ClientID, redirect, verifier)
	if !errors.Is(err, agent_credentials.ErrBadCode) {
		t.Fatalf("second exchange = %v, want ErrBadCode", err)
	}

	wrong, _ := store.MintCode(ctx, grant)

	_, _, err = store.Exchange(ctx, wrong, client.ClientID, redirect, strings.Repeat("x", 50))
	if !errors.Is(err, agent_credentials.ErrBadCode) {
		t.Fatalf("a wrong verifier = %v, want ErrBadCode", err)
	}

	_, _, err = store.Exchange(ctx, wrong, client.ClientID, redirect, verifier)
	if !errors.Is(err, agent_credentials.ErrBadCode) {
		t.Fatalf("the right verifier after a wrong one = %v, want ErrBadCode — the code is spent", err)
	}
}

// A code is the client's and the redirect's it was minted for.
func TestStore_ACodeIsItsClientsAndItsRedirects(t *testing.T) {
	db := san_testdb.DB(t)
	store := agent_credentials.NewStore(db)
	userID := person(t, db)
	ctx := context.Background()

	client, _ := store.RegisterClient(ctx, "ChatGPT", []string{redirect, "https://chatgpt.com/other"})
	other, _ := store.RegisterClient(ctx, "Elsewhere", []string{redirect})

	for name, exchange := range map[string]func(code string) error{
		"another client": func(code string) error {
			_, _, err := store.Exchange(ctx, code, other.ClientID, redirect, verifier)
			return err
		},
		"another redirect": func(code string) error {
			_, _, err := store.Exchange(ctx, code, client.ClientID, "https://chatgpt.com/other", verifier)
			return err
		},
	} {
		code, _ := store.MintCode(ctx, agent_credentials.CodeGrant{
			ClientID: client.ClientID, RedirectURI: redirect, CodeChallenge: challengeOf(verifier),
			UserID: userID, TeamID: 5, Name: "x",
		})

		err := exchange(code)
		if !errors.Is(err, agent_credentials.ErrBadCode) {
			t.Fatalf("%s = %v, want ErrBadCode", name, err)
		}
	}
}

// An expired code is no code.
func TestStore_AnExpiredCodeIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	userID := person(t, db)
	ctx := context.Background()

	minted := time.Now().Add(-time.Hour)
	store := agent_credentials.NewStore(db).WithClock(func() time.Time { return minted })

	client, _ := store.RegisterClient(ctx, "ChatGPT", []string{redirect})
	code, _ := store.MintCode(ctx, agent_credentials.CodeGrant{
		ClientID: client.ClientID, RedirectURI: redirect, CodeChallenge: challengeOf(verifier),
		UserID: userID, TeamID: 5, Name: "x",
	})

	_, _, err := agent_credentials.NewStore(db).Exchange(ctx, code, client.ClientID, redirect, verifier)
	if !errors.Is(err, agent_credentials.ErrBadCode) {
		t.Fatalf("an hour-old code = %v, want ErrBadCode", err)
	}
}

// A revoked or expired credential reads nothing.
func TestStore_ARevokedOrExpiredCredentialIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	store := agent_credentials.NewStore(db)
	userID := person(t, db)
	ctx := context.Background()

	revoked, credential := connected(t, store, userID, 5)
	db.Model(&user_service_models.AgentCredential{}).Where("id = ?", credential.ID).Update("revoked_at", time.Now())

	_, err := store.VerifyAgent(ctx, revoked)
	if !errors.Is(err, access_interceptors.ErrInvalidAgentCredential) {
		t.Fatalf("a revoked credential = %v, want ErrInvalidAgentCredential", err)
	}

	expired, _ := connected(t, store, userID, 5)
	later := agent_credentials.NewStore(db).WithClock(func() time.Time { return time.Now().Add(agent_credentials.Lifetime + time.Hour) })

	_, err = later.VerifyAgent(ctx, expired)
	if !errors.Is(err, access_interceptors.ErrInvalidAgentCredential) {
		t.Fatalf("a credential past 90 days = %v, want ErrInvalidAgentCredential", err)
	}

	_, err = store.VerifyAgent(ctx, access_interceptors.AgentTokenPrefix+"never-minted")
	if !errors.Is(err, access_interceptors.ErrInvalidAgentCredential) {
		t.Fatalf("an unknown bearer = %v, want ErrInvalidAgentCredential", err)
	}
}

// The last use is stamped — at most once a minute, so a read is not a write.
func TestStore_TheLastUseIsStampedAtMostOnceAMinute(t *testing.T) {
	db := san_testdb.DB(t)
	store := agent_credentials.NewStore(db)
	userID := person(t, db)
	ctx := context.Background()

	token, credential := connected(t, store, userID, 5)

	_, _ = store.VerifyAgent(ctx, token)

	var first user_service_models.AgentCredential
	db.First(&first, credential.ID)

	if first.LastUsedAt == nil {
		t.Fatal("the first read stamped no last use")
	}

	_, _ = store.VerifyAgent(ctx, token)

	var second user_service_models.AgentCredential
	db.First(&second, credential.ID)

	if !second.LastUsedAt.Equal(*first.LastUsedAt) {
		t.Fatalf("a second read within the minute moved the stamp %v → %v", first.LastUsedAt, second.LastUsedAt)
	}
}

// A registration names https redirects, or http on this machine — and refuses anything else.
func TestStore_ARegistrationNeedsAnAcceptableRedirect(t *testing.T) {
	db := san_testdb.DB(t)
	store := agent_credentials.NewStore(db)
	ctx := context.Background()

	for _, uris := range [][]string{
		nil,
		{"http://evil.example.com/cb"},
		{"javascript:alert(1)"},
		{"https://ok.example.com/cb#fragment"},
	} {
		_, err := store.RegisterClient(ctx, "x", uris)
		if !errors.Is(err, agent_credentials.ErrBadRegistration) {
			t.Fatalf("redirects %v = %v, want ErrBadRegistration", uris, err)
		}
	}

	for _, uri := range []string{"https://claude.ai/api/mcp/auth_callback", "http://localhost:6274/cb", "http://127.0.0.1:33418/cb"} {
		_, err := store.RegisterClient(ctx, "x", []string{uri})
		if err != nil {
			t.Fatalf("redirect %s refused: %v", uri, err)
		}
	}

	client, _ := store.RegisterClient(ctx, "x", []string{redirect})

	_, err := store.Client(ctx, client.ClientID, redirect+"/more")
	if !errors.Is(err, agent_credentials.ErrBadRedirect) {
		t.Fatalf("a redirect extended past the registered one = %v, want ErrBadRedirect — exact match only", err)
	}
}
