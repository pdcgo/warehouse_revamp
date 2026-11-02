package access_interceptors

import (
	"context"
	"errors"
	"strings"
	"time"
)

// AgentTokenPrefix marks an AI AGENT's bearer (an-agent-gets-its-own-team-credential), so the interceptor knows which
// check to run without trying the JWT first. A session token is a JWT and never starts with it.
const AgentTokenPrefix = "wha_"

// IsAgentToken is whether a bearer is an agent's credential rather than a person's session.
func IsAgentToken(token string) bool {
	return strings.HasPrefix(token, AgentTokenPrefix)
}

// AgentGrant is what an agent's credential reads for: the person who connected it and the ONE team it reads — or
// every team (TeamID 0) for root's bypass (a-roots-agent-reads-every-team).
type AgentGrant struct {
	CredentialID uint64
	UserID       uint64
	TeamID       uint64
	ExpiresAt    time.Time
}

// ErrInvalidAgentCredential is a bearer that is not a live agent credential — unknown, revoked or expired. A verifier
// answers it (wrapped or not) for every such bearer, so a caller can tell it from the database failing.
var ErrInvalidAgentCredential = errors.New("the agent credential is unknown, revoked or expired")

// AgentVerifier checks an agent's bearer — live, not revoked, not expired — and answers its grant. user_service's
// agent_credentials.Store is the one implementation.
type AgentVerifier interface {
	VerifyAgent(ctx context.Context, token string) (*AgentGrant, error)
}

// Option configures the interceptor.
type Option func(*interceptor)

// WithAgentVerifier lets AI agents in (our-server-hosts-the-mcp). Without it an agent's bearer is refused like any
// unparseable token.
func WithAgentVerifier(verifier AgentVerifier) Option {
	return func(i *interceptor) {
		i.agents = verifier
	}
}

type agentGrantKey struct{}

func withAgentGrant(ctx context.Context, grant *AgentGrant) context.Context {
	return context.WithValue(ctx, agentGrantKey{}, grant)
}

// AgentGrantFrom is the agent a call was made by, or nil for a person's session.
func AgentGrantFrom(ctx context.Context) *AgentGrant {
	grant, _ := ctx.Value(agentGrantKey{}).(*AgentGrant)

	return grant
}
