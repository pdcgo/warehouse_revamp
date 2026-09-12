package settlement_service_models

import "time"

// OrderSettlement is a row of `order_settlements` — one order's current position, and a PROJECTION of
// SettlementLog rather than a fact of its own.
//
// It exists because "what did this order net" is asked far more often than it changes. Both figures
// below are recomputable from the log alone, which is what keeps the ledger auditable:
//
//	InitialTotal = −SUM(Change) over the two initial types
//	LastBalance  =  SUM(Change) over every row
type OrderSettlement struct {
	// ⚠ THE ORDER IS THE KEY. One account per order, and the row a writer LOCKS to serialise
	// concurrent posts.
	OrderID uint64 `gorm:"primaryKey"`

	// ⚠ THE LIVE SALE, STORED POSITIVE — the one place the log's sign convention is inverted, so no
	// screen ever negates by hand. A cancel zeroes it rather than leaving the historical figure.
	//
	// ⚠ 0 MEANS NOT RECORDED, never "sold for nothing".
	InitialTotal int64

	// The current position. Negative means part of what the buyer paid never reached us, and it is
	// NOT expected to reach zero — the residual is the platform's unitemised take.
	LastBalance int64

	TeamID uint64
	ShopID uint64

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (OrderSettlement) TableName() string {
	return "order_settlements"
}
