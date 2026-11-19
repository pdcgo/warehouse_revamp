package selling_service_models

import "time"

// OrderShopChange is a row of `order_shop_changes` (00051) — one FIX of an order's shop
// (an-orders-shop-is-fixed-and-counted-on-the-day): the shop the order was filed under, the one it moved to, and the
// note row the fix wrote on the order's timeline. Append-only. Schema owned by goose (db_migrations).
//
// It is what keeps a past day of the order metrics where it was: a move of the order is counted under the shop the
// order was in WHEN it moved — the from-shop of the first fix after the move's timeline row, or the order's shop now
// when no fix came after (shopAsOf). Without it the order's one `shop_id` would re-file every past day on a re-fold.
type OrderShopChange struct {
	ID      uint64 `gorm:"primaryKey"`
	OrderID uint64
	TeamID  uint64

	FromShopID uint64
	ToShopID   uint64

	// The note row the fix wrote. Every timeline row of one order is written under the order's row lock, so the rows
	// before this one are exactly the moves the order had made when it was fixed.
	TimelineLogID uint64

	// WHO fixed it — an opaque user_service id, 0 = not recorded — and whether from outside the team
	// (an-override-is-stamped-in-every-service). The same pair as the timeline row's.
	ActorID    uint64
	IsOverride bool

	// The fix's instant — its timeline row's. The day the order metrics count the move on.
	CreatedAt time.Time
}

func (OrderShopChange) TableName() string {
	return "order_shop_changes"
}
