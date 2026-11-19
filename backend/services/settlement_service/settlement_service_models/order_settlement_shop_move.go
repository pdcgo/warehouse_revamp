package settlement_service_models

import "time"

// OrderSettlementShopMove is a row of `order_settlement_shop_moves` (00012) — one OrderShopChanged settlement applied
// to an order's account (an-orders-shop-is-fixed-and-counted-on-the-day): the order's fix, the shop the account was
// on, and the shop it moved to.
//
// ⚠ IT IS THE CLAIM. The key is the fix's id (selling's `order_shop_changes`, opaque, no FK): a redelivery inserts
// nothing and moves nothing. Fixes of one order carry ascending ids, so a fix delivered after a later one was applied
// finds the larger id here and moves nothing — the account always ends on the order's latest shop.
type OrderSettlementShopMove struct {
	ChangeID uint64 `gorm:"primaryKey;autoIncrement:false"`
	OrderID  uint64
	TeamID   uint64

	// The shop the ACCOUNT was on, and the one it is on now — equal when nothing moved (no account yet, already
	// there, or a later fix already applied).
	FromShopID uint64
	ToShopID   uint64

	CreatedAt time.Time
}

func (OrderSettlementShopMove) TableName() string {
	return "order_settlement_shop_moves"
}
