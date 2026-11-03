package inventory_service_models

import "time"

// OpnameRowStatus is opname_session_snapshots.status (a-snapshot-row-is-created-then-counted).
type OpnameRowStatus string

const (
	OpnameRowCreated OpnameRowStatus = "created"
	OpnameRowCounted OpnameRowStatus = "counted"
)

// OpnameSessionSnapshot is a row of `opname_session_snapshots` — one product on one rack in one session
// (a-snapshot-row-per-product-on-a-rack). While ReleasedAt is nil the row IS the count's lock on that product on that
// rack (the-lock-is-the-open-snapshot-row). RecountedStockCount is the one count column — the blind count, or the recount
// that replaced it (a-row-keeps-only-its-latest-count); nil until counted, which is what "revealed" means.
type OpnameSessionSnapshot struct {
	ID                  uint64 `gorm:"primaryKey"`
	WarehouseID         uint64
	TeamID              uint64
	ProductID           uint64
	PlacementID         uint64
	OpnameSessionID     uint64
	Status              OpnameRowStatus
	SystemStockCount    int64
	RecountedStockCount *int64
	// The one recount is used.
	Recounted bool
	// Added by a counter as found on this rack (a-counter-may-add-a-product-found-here).
	FoundHere bool
	// Whoever entered the count that stands (a-snapshot-row-names-its-counter).
	CountedByID *uint64
	// Snapshots taken when the row was made — the catalogue is product_service's.
	ProductCode string
	ProductName string
	ReleasedAt  *time.Time
	CreatedAt   time.Time
}

func (OpnameSessionSnapshot) TableName() string {
	return "opname_session_snapshots"
}

// Revealed is whether the row's count is in, so the book figure may be shown (a-count-is-blind-then-revealed).
func (r OpnameSessionSnapshot) Revealed() bool {
	return r.RecountedStockCount != nil
}

// Count is the count that stands, 0 before one is entered.
func (r OpnameSessionSnapshot) Count() int64 {
	if r.RecountedStockCount == nil {
		return 0
	}

	return *r.RecountedStockCount
}
