package selling_service_models

import "time"

// TeamReturnConfiguration is a row of `team_return_configurations` — the warehouse a selling team's returns
// are received at (the-return-warehouse-lives-in-team-return-configurations). One per team; no row = not set.
// Schema owned by goose (db_migrations).
type TeamReturnConfiguration struct {
	ID     uint64 `gorm:"primaryKey"`
	TeamID uint64

	// Opaque team_service id of a warehouse team. Any warehouse may be named
	// (a-team-may-pick-any-return-warehouse).
	WarehouseID uint64

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (TeamReturnConfiguration) TableName() string {
	return "team_return_configurations"
}
