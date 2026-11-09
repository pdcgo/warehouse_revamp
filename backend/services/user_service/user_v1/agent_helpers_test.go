package user_v1_test

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"testing"

	"gorm.io/gorm"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/agent_credentials"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
)

// The AI-agent tests' shared fixture: an agent registered, and connections made through the real store.

const (
	agentRedirect = "https://chatgpt.com/connector/oauth/callback"
	agentVerifier = "a-verifier-that-is-long-enough-to-be-a-real-pkce-verifier-0123456789"
)

func agentChallenge() string {
	sum := sha256.Sum256([]byte(agentVerifier))

	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func newAgentService(t *testing.T, db *gorm.DB) (*user_v1.AgentService, *agent_credentials.Store) {
	t.Helper()

	store := agent_credentials.NewStore(db)
	resolver := access_interceptors.NewDBRoleResolver(db, san_caches.NewSkipCacheManager())

	return user_v1.NewAgentService(db, store, resolver), store
}

func registerAgent(t *testing.T, store *agent_credentials.Store) string {
	t.Helper()

	client, err := store.RegisterClient(context.Background(), "ChatGPT", []string{agentRedirect})
	if err != nil {
		t.Fatalf("register: %v", err)
	}

	return client.ClientID
}

// connectAgent makes a live connection for the person reading the team, as the OAuth would.
func connectAgent(t *testing.T, store *agent_credentials.Store, clientID string, userID, teamID uint64, name string) *user_service_models.AgentCredential {
	t.Helper()

	ctx := context.Background()

	code, err := store.MintCode(ctx, agent_credentials.CodeGrant{
		ClientID: clientID, RedirectURI: agentRedirect, CodeChallenge: agentChallenge(),
		UserID: userID, TeamID: teamID, Name: name,
	})
	if err != nil {
		t.Fatalf("mint: %v", err)
	}

	_, credential, err := store.Exchange(ctx, code, clientID, agentRedirect, agentVerifier)
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}

	return credential
}

// connectionsOf unpacks a connection list's CONNECTION slice, in the list's order.
func connectionsOf(items []*userv1.AgentConnectionListResponseItem, ids []uint64) []*userv1.AgentConnection {
	m := map[uint64]*userv1.AgentConnection{}

	for _, item := range items {
		if c := item.GetConnection(); c != nil {
			m = c.GetMapData()
		}
	}

	out := make([]*userv1.AgentConnection, 0, len(ids))
	for _, id := range ids {
		out = append(out, m[id])
	}

	return out
}
