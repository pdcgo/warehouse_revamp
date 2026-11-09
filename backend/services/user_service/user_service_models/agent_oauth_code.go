package user_service_models

import "time"

// AgentOAuthCode is the one-time code the connect page mints, traded once for a credential. Only its SHA-256 is kept.
type AgentOAuthCode struct {
	ID            uint64 `gorm:"primaryKey"`
	CodeHash      string
	ClientID      string
	UserID        uint64
	TeamID        uint64
	Name          string
	RedirectURI   string
	CodeChallenge string
	ExpiresAt     time.Time
	UsedAt        *time.Time
	CreatedAt     time.Time
}

func (AgentOAuthCode) TableName() string {
	return "agent_oauth_codes"
}
