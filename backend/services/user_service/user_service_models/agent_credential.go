package user_service_models

import "time"

// AgentCredential is an AI agent's own credential (an-agent-gets-its-own-team-credential) — read-only, one team or
// every team (TeamID 0, root's bypass), 90 days, revoked on its own. Only the bearer's SHA-256 is kept.
type AgentCredential struct {
	ID         uint64 `gorm:"primaryKey"`
	TokenHash  string
	UserID     uint64
	TeamID     uint64
	Name       string
	ClientID   string
	ClientName string
	CreatedAt  time.Time
	ExpiresAt  time.Time
	LastUsedAt *time.Time
	RevokedAt  *time.Time
}

func (AgentCredential) TableName() string {
	return "agent_credentials"
}
