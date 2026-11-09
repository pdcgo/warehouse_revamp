package user_service_models

import (
	"encoding/json"
	"slices"
	"time"
)

// AgentOAuthClient is an agent that registered itself (RFC 7591) — a public client: no secret, PKCE instead.
type AgentOAuthClient struct {
	ID         uint64 `gorm:"primaryKey"`
	ClientID   string
	ClientName string
	// The exact redirect URIs, a JSON array of strings.
	RedirectURIs string `gorm:"column:redirect_uris;type:jsonb"`
	CreatedAt    time.Time
}

func (AgentOAuthClient) TableName() string {
	return "agent_oauth_clients"
}

// AllowsRedirect is whether `uri` is one the client registered — EXACTLY, never a prefix: a code sent anywhere else is
// a code handed to whoever owns that page.
func (c *AgentOAuthClient) AllowsRedirect(uri string) bool {
	var uris []string

	err := json.Unmarshal([]byte(c.RedirectURIs), &uris)
	if err != nil {
		return false
	}

	return slices.Contains(uris, uri)
}
