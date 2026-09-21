package team_service_models

import "time"

// Team is a row of `teams`. The schema is owned by goose (db_migrations); GORM only reads and
// writes rows — there is no AutoMigrate, because two sources of schema truth is exactly the
// drift this project exists to avoid.
type Team struct {
	ID          uint64 `gorm:"primaryKey"`
	Type        string
	Name        string
	TeamCode    string
	Description string
	ImageURL    string
	Deleted     bool

	// THE PRIORITY-PRODUCT FEATURE (owner), granted by ROOT and applying to the team's WHOLE
	// catalogue — every product it owns is a priority product to everybody browsing.
	//
	// ⚠ NOT writable through TeamInfoUpdate: that message is callable by ROLE_TEAM_OWNER, and a
	// capability granted by root must not be settable by the team it is granted to. See the migration
	// 00007_team_priority_product.sql for the whole reasoning.
	PriorityProduct bool

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Team) TableName() string {
	return "teams"
}

// TeamInfo is a team's transfer/return metadata. 1:1 with a team, enforced by a UNIQUE index
// on team_id — which is what makes the upsert safe.
type TeamInfo struct {
	ID     uint64 `gorm:"primaryKey"`
	TeamID uint64

	// Owned by other services. Pointers because NULL means "unset", which is different from 0.
	ReturnWarehouseID *uint64
	ReturnUserID      *uint64
	// The warehouse this SELLING team ships from by default (#145). NULL = not configured.
	DefaultWarehouseID *uint64

	ContactNumber     string
	BankType          string
	BankOwnerName     string
	BankAccountNumber string

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (TeamInfo) TableName() string {
	return "team_infos"
}
