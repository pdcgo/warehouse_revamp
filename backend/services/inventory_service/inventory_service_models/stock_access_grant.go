package inventory_service_models

import "time"

// StockAccessGrant is a row of `stock_access_grants` (#147) — the arrangement by which a WAREHOUSE lets
// a SELLING team draw its stock.
//
// Both ids are OPAQUE cross-service ids (team_service) — no FK. Scope is enforced by the access
// interceptor, not the DB.
//
// ⚠ Nothing consults these rows yet: teaching the scope check to read them is #148, kept separate
// because that change touches the interceptor every RPC's authorization runs through.
type StockAccessGrant struct {
	ID uint64 `gorm:"primaryKey"`

	// The warehouse whose stock may be drawn — the team that GRANTS.
	WarehouseID uint64
	// The selling team allowed to draw it.
	SellingTeamID uint64

	// Soft delete: "who was allowed to take our stock, and when did that stop" is exactly the question
	// someone asks after a discrepancy, and a deleted row cannot answer it. A partial unique index means
	// revoking frees the pair to be granted again.
	Revoked bool

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (StockAccessGrant) TableName() string {
	return "stock_access_grants"
}
