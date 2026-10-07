package user_service_models

import "time"

// TeamMemberLog is a row of `team_member_logs` — one change to a team's membership (every-role-change-is-logged).
// Append-only: written in the same transaction as the change, never updated, never deleted.
type TeamMemberLog struct {
	ID     uint64 `gorm:"primaryKey"`
	TeamID uint64

	// A person, or nil with ActorAgent set when a developer acted through tools/san.
	ActorUserID *uint64
	ActorAgent  string

	UserID uint64

	// warehouse.user.v1.TeamMemberLogAction.
	Action int16

	// warehouse.role_base.v1.Role numbers; 0 before an add and after a removal.
	RoleBefore int32
	RoleAfter  int32

	IsOverride bool

	CreatedAt time.Time
}

func (TeamMemberLog) TableName() string {
	return "team_member_logs"
}
