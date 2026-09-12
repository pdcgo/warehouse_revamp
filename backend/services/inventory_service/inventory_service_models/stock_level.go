package inventory_service_models

import "time"

// StockLevel is a row of `stock_levels` — the DERIVED on-hand of a product at a warehouse. It is a
// cache of SUM(delta) over the ledger, maintained inside each movement's transaction; a CHECK keeps
// on_hand >= 0. Schema owned by goose (db_migrations); GORM only reads/writes rows (no AutoMigrate).
//
// warehouse_id and product_id are OPAQUE cross-service ids (team_service / product_service) — no FK.
// rack_id IS a real FK: racks live in this same service.
//
// ⚠ The identity below is (warehouse, product, rack) and RackID is NULLABLE, which GORM cannot express
// safely: a `primaryKey` tag on a nil *uint64 makes GORM generate `rack_id = NULL`, and in SQL that
// matches NOTHING — it is never true, not even against a NULL. Every write to this table therefore
// goes through RAW SQL using `IS NOT DISTINCT FROM` (see applyDelta), never GORM's primary-key path.
// Do not add Save()/Updates()-by-PK against this model: it would silently no-op on unplaced stock.
//
// The DB enforces the identity with a UNIQUE INDEX (`stock_levels_place_unique`) rather than a PK,
// because a PK column may not be NULL and "unplaced" must be. It carries NULLS NOT DISTINCT so a
// product can only ever have ONE unplaced row per warehouse.
type StockLevel struct {
	WarehouseID uint64 `gorm:"primaryKey"`
	ProductID   uint64 `gorm:"primaryKey"`

	// Where in the warehouse it physically sits (#135). NULL = UNPLACED: somewhere in this warehouse,
	// not yet on a shelf. Unplaced is a real, workable state (the put-away queue, #136) — it is what
	// arrived but has not been put away — not a missing value.
	RackID *uint64 `gorm:"primaryKey"`

	OnHand    int64
	UpdatedAt time.Time
}

func (StockLevel) TableName() string {
	return "stock_levels"
}
