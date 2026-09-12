package settlement_service_models

import "time"

// ShopSettlement is a row of `shop_settlements` — one shop's DIRECT position, and the mirror of
// OrderSettlement for the second grain (#an-entry-names-an-order-or-a-shop).
//
// ⚠ IT EXISTS TO BE LOCKED. A shop-addressed write computes the next `balance` from the previous one,
// so without a row to take FOR UPDATE two concurrent posts read the same previous value and the second
// silently overwrites the first's position. That is the same job `order_settlements.order_id` has done
// for the order grain since the first migration.
//
// Like OrderSettlement it is a PROJECTION and recomputable from the log alone:
//
//	LastBalance = SUM(Change) over every row with ShopID = this and OrderID IS NULL
type ShopSettlement struct {
	// ⚠ THE SHOP IS THE KEY — one column, so the row is lockable by a single value. A shop belongs to
	// one team, so TeamID rides along denormalised rather than joining the key.
	ShopID uint64 `gorm:"primaryKey"`

	TeamID uint64

	// ⚠ THE SHOP'S OWN DIRECT MOVEMENTS ONLY, never its whole position. Order-addressed rows carry the
	// same ShopID and fold into the same daily report, so the report's `close_balance` is a different
	// and larger number. Two figures, one word — use this one only where "what moved outside the
	// orders" is what is meant.
	LastBalance int64

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (ShopSettlement) TableName() string {
	return "shop_settlements"
}
