package user_service_models

import "time"

// TeamAgentPolicy is whether a team's CS and staff may connect an agent (the-owner-decides-who-connects-an-agent).
// No row reads as off.
type TeamAgentPolicy struct {
	TeamID            uint64 `gorm:"primaryKey"`
	MembersMayConnect bool
	UpdatedByUserID   *uint64
	UpdatedAt         time.Time

	// The last setter was Root or the Administrator, outside the team (an-override-is-stamped-in-every-service).
	IsOverride bool
}

func (TeamAgentPolicy) TableName() string {
	return "team_agent_policies"
}
