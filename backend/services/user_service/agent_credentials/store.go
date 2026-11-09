// Package agent_credentials holds an AI agent's own credential (an-agent-gets-its-own-team-credential) and the OAuth
// pieces that mint it (our-server-hosts-the-mcp): the registered clients, the one-time codes, the exchange, and the
// check the access interceptor runs on every call an agent makes.
//
// It is user_service's — identity is — and it is functions over user_service's own tables. The RPCs that use it are
// user_v1's AgentService; the plain-HTTP OAuth endpoints are agent_oauth's.
package agent_credentials

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

const (
	// Lifetime is how long a credential reads — then the person connects again (an-agent-gets-its-own-team-credential).
	Lifetime = 90 * 24 * time.Hour

	// codeLifetime is how long the connect page's code waits for the agent's exchange. The agent exchanges it at once.
	codeLifetime = 5 * time.Minute

	// lastUsedEvery bounds the last-used stamp to one write a minute per credential — a write per read would make every
	// agent call a write.
	lastUsedEvery = time.Minute

	// maxRedirectURIs bounds what one registration may claim.
	maxRedirectURIs = 10
)

var (
	ErrUnknownClient = errors.New("this agent is not registered — connect it again from the agent")
	ErrBadRedirect   = errors.New("the redirect is not one the agent registered")
	// ErrBadCode is the exchange's every refusal of the code itself — unknown, used, expired, another client's, another
	// redirect's, or a verifier that does not match. One error, so the answer tells a guesser nothing.
	ErrBadCode = errors.New("the code is unknown, used, expired or not yours")
	// ErrInvalidCredential is a bearer that is not a live agent credential.
	ErrInvalidCredential = access_interceptors.ErrInvalidAgentCredential
	ErrBadRegistration   = errors.New("a registration needs at least one redirect — https, or http on this machine")
)

// Store is the credential's functions over user_service's tables.
type Store struct {
	db  *gorm.DB
	now func() time.Time
}

func NewStore(db *gorm.DB) *Store {
	return &Store{db: db, now: time.Now}
}

// WithClock is for tests: the store reads `now` instead of the wall clock.
func (s *Store) WithClock(now func() time.Time) *Store {
	return &Store{db: s.db, now: now}
}

// RegisterClient records an agent that registered itself (RFC 7591) — a public client, so no secret: PKCE proves the
// exchange instead. Every redirect must be https, or http on this machine (a native agent's loopback callback).
func (s *Store) RegisterClient(
	ctx context.Context,
	name string,
	redirectURIs []string,
) (*user_service_models.AgentOAuthClient, error) {
	if len(redirectURIs) == 0 || len(redirectURIs) > maxRedirectURIs {
		return nil, ErrBadRegistration
	}

	for _, uri := range redirectURIs {
		if !acceptableRedirect(uri) {
			return nil, ErrBadRegistration
		}
	}

	uris, err := json.Marshal(redirectURIs)
	if err != nil {
		return nil, err
	}

	id, err := randomToken(16)
	if err != nil {
		return nil, err
	}

	client := user_service_models.AgentOAuthClient{
		ClientID:     "agent_" + id,
		ClientName:   clip(strings.TrimSpace(name), 100),
		RedirectURIs: string(uris),
		CreatedAt:    s.now(),
	}

	err = s.db.WithContext(ctx).Create(&client).Error
	if err != nil {
		return nil, err
	}

	return &client, nil
}

// Client is the registered agent, and whether `redirectURI` is one of its own — exactly.
func (s *Store) Client(ctx context.Context, clientID, redirectURI string) (*user_service_models.AgentOAuthClient, error) {
	// Find, never Take: an unknown client is an answer, not an error worth a log line.
	var clients []user_service_models.AgentOAuthClient

	err := s.db.WithContext(ctx).
		Where("client_id = ?", clientID).
		Limit(1).
		Find(&clients).
		Error
	if err != nil {
		return nil, err
	}

	if len(clients) == 0 {
		return nil, ErrUnknownClient
	}

	client := clients[0]

	if !client.AllowsRedirect(redirectURI) {
		return nil, ErrBadRedirect
	}

	return &client, nil
}

// CodeGrant is what the person allowed on the connect page: which agent, sent back where, for whom, reading which team
// (0 = every team), under which name — and the agent's PKCE challenge.
type CodeGrant struct {
	ClientID      string
	RedirectURI   string
	CodeChallenge string
	UserID        uint64
	TeamID        uint64
	Name          string
}

// MintCode stores the grant under a one-time code and returns the code — the only time it exists in the clear.
func (s *Store) MintCode(ctx context.Context, grant CodeGrant) (string, error) {
	code, err := randomToken(32)
	if err != nil {
		return "", err
	}

	now := s.now()

	row := user_service_models.AgentOAuthCode{
		CodeHash:      hashOf(code),
		ClientID:      grant.ClientID,
		UserID:        grant.UserID,
		TeamID:        grant.TeamID,
		Name:          grant.Name,
		RedirectURI:   grant.RedirectURI,
		CodeChallenge: grant.CodeChallenge,
		ExpiresAt:     now.Add(codeLifetime),
		CreatedAt:     now,
	}

	err = s.db.WithContext(ctx).Create(&row).Error
	if err != nil {
		return "", err
	}

	return code, nil
}

// Exchange trades a code for the agent's credential (the token endpoint). The code is SPENT by the statement that reads
// it — `UPDATE … WHERE used_at IS NULL RETURNING` — so two exchanges of one code, at the same instant, mint one
// credential; and a refused exchange spends it too, so a wrong verifier cannot be retried against the same code.
//
// It returns the bearer, which exists in the clear only here, and the credential it names.
func (s *Store) Exchange(
	ctx context.Context,
	code, clientID, redirectURI, verifier string,
) (string, *user_service_models.AgentCredential, error) {
	var (
		token      string
		credential user_service_models.AgentCredential
	)

	now := s.now()

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var spent []user_service_models.AgentOAuthCode

		err := tx.
			Model(&spent).
			Clauses(clause.Returning{}).
			Where("code_hash = ? AND used_at IS NULL AND expires_at > ?", hashOf(code), now).
			Update("used_at", now).
			Error
		if err != nil {
			return err
		}

		if len(spent) != 1 {
			return ErrBadCode
		}

		grant := spent[0]

		if grant.ClientID != clientID || grant.RedirectURI != redirectURI || !pkceMatches(grant.CodeChallenge, verifier) {
			return ErrBadCode
		}

		var client user_service_models.AgentOAuthClient

		err = tx.Where("client_id = ?", clientID).Take(&client).Error
		if err != nil {
			return err
		}

		token, err = randomToken(32)
		if err != nil {
			return err
		}

		token = access_interceptors.AgentTokenPrefix + token

		credential = user_service_models.AgentCredential{
			TokenHash:  hashOf(token),
			UserID:     grant.UserID,
			TeamID:     grant.TeamID,
			Name:       grant.Name,
			ClientID:   clientID,
			ClientName: client.ClientName,
			CreatedAt:  now,
			ExpiresAt:  now.Add(Lifetime),
		}

		return tx.Create(&credential).Error
	})
	if err != nil {
		// A spent code is committed even when the exchange is refused — the refusal rolled back, so spend it again
		// outside the transaction. Best-effort: the code also expires on its own.
		if errors.Is(err, ErrBadCode) {
			_ = s.db.WithContext(ctx).
				Model(&user_service_models.AgentOAuthCode{}).
				Where("code_hash = ? AND used_at IS NULL", hashOf(code)).
				Update("used_at", now).
				Error
		}

		return "", nil, err
	}

	return token, &credential, nil
}

// VerifyAgent is the access interceptor's check on an agent's bearer (access_interceptors.AgentVerifier): a live
// credential — not revoked, not expired — and who it reads for. It stamps the last use, at most once a minute.
func (s *Store) VerifyAgent(ctx context.Context, token string) (*access_interceptors.AgentGrant, error) {
	now := s.now()

	// Find, never Take: a revoked bearer is an answer, not an error worth a log line.
	var credentials []user_service_models.AgentCredential

	err := s.db.WithContext(ctx).
		Where("token_hash = ? AND revoked_at IS NULL AND expires_at > ?", hashOf(token), now).
		Limit(1).
		Find(&credentials).
		Error
	if err != nil {
		return nil, err
	}

	if len(credentials) == 0 {
		return nil, ErrInvalidCredential
	}

	credential := credentials[0]

	if credential.LastUsedAt == nil || now.Sub(*credential.LastUsedAt) >= lastUsedEvery {
		// Best-effort: a missed stamp costs a stale "last used", never a refused read.
		_ = s.db.WithContext(ctx).
			Model(&user_service_models.AgentCredential{}).
			Where("id = ? AND (last_used_at IS NULL OR last_used_at < ?)", credential.ID, now.Add(-lastUsedEvery)).
			Update("last_used_at", now).
			Error
	}

	return &access_interceptors.AgentGrant{
		CredentialID: credential.ID,
		UserID:       credential.UserID,
		TeamID:       credential.TeamID,
		ExpiresAt:    credential.ExpiresAt,
	}, nil
}

// hashOf is the hex SHA-256 a secret is kept as. A code or a bearer is 32 random bytes, so a plain hash is enough —
// there is nothing to brute-force that a salt would slow.
func hashOf(secret string) string {
	sum := sha256.Sum256([]byte(secret))

	return hex.EncodeToString(sum[:])
}

// pkceMatches is RFC 7636's S256: base64url(SHA-256(verifier)), unpadded, against the challenge — in constant time.
func pkceMatches(challenge, verifier string) bool {
	if len(verifier) < 43 || len(verifier) > 128 {
		return false
	}

	sum := sha256.Sum256([]byte(verifier))
	computed := base64.RawURLEncoding.EncodeToString(sum[:])

	return subtle.ConstantTimeCompare([]byte(computed), []byte(challenge)) == 1
}

// acceptableRedirect is https anywhere, or http on a loopback host — never a bare scheme or a fragment.
func acceptableRedirect(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.Fragment != "" {
		return false
	}

	switch u.Scheme {
	case "https":
		return true
	case "http":
		host := u.Hostname()
		if host == "localhost" {
			return true
		}

		ip := net.ParseIP(host)

		return ip != nil && ip.IsLoopback()
	default:
		return false
	}
}

func randomToken(size int) (string, error) {
	buf := make([]byte, size)

	_, err := rand.Read(buf)
	if err != nil {
		return "", err
	}

	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func clip(s string, max int) string {
	runes := []rune(s)
	if len(runes) > max {
		return string(runes[:max])
	}

	return s
}
