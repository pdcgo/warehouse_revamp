package inventory_service_models

import "time"

// WarehouseProduct is a row of `warehouse_products` — the arrangement that a warehouse HANDLES a
// product (#142).
//
// A warehouse must not see the whole catalogue; it sees what somebody has asked it to hold. Today that
// asking is a restock request (owner, 2026-07-20), or a transfer coming to it
// (a-transfer-links-its-products-to-the-receiver) — the only two writers.
//
// It is deliberately NOT derived from the rack rows. A product asked for but not yet received has no stock
// level, and the crew expecting it still need to find it — so "handles" and "currently holds" are two
// different facts with two different tables.
//
// ProductID is an OPAQUE product_service id (no cross-service FK); WarehouseID is a team id.
type WarehouseProduct struct {
	ID          uint64 `gorm:"primaryKey"`
	WarehouseID uint64
	ProductID   uint64
	CreatedAt   time.Time
}

func (WarehouseProduct) TableName() string {
	return "warehouse_products"
}
