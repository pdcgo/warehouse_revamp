package user_service_models

import "time"

// User is a row of `users`. Schema owned by goose; GORM only reads and writes rows.
type User struct {
	ID       uint64 `gorm:"primaryKey"`
	Name     string
	Username string

	// bcrypt hash. An EMPTY string means "cannot log in" — bcrypt never matches it. That is how
	// the seeded root account exists without a password.
	Password string

	Email             string
	PhoneNumber       string
	IsSuspended       bool
	AvatarURL         string
	LastPasswordReset *time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

func (User) TableName() string {
	return "users"
}

// UserTeamRole is one membership: this user holds this role in this team.
//
// UNIQUE (team_id, user_id) — at most one role per user per team. That uniqueness is what lets
// the authorization path read a single scalar and cache it.
type UserTeamRole struct {
	ID     uint64 `gorm:"primaryKey"`
	TeamID uint64

	UserID uint64

	// The raw warehouse.role_base.v1.Role enum NUMBER.
	Role      int32
	Alias     string
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (UserTeamRole) TableName() string {
	return "user_team_roles"
}
