package selling_v1

import (
	"context"
	"time"
)

// SaleOpening is a placed order as settlement_service needs it, in this service's own terms.
type SaleOpening struct {
	TeamID  uint64
	ShopID  uint64
	OrderID uint64

	// What the buyer paid on the marketplace — `orders.marketplace_total`, whole rupiah, POSITIVE.
	MarketplaceTotal int64

	// Who created the order, read from the token at placement.
	CreatedByUserID uint64

	// When the order was placed — its own CreatedAt, so a retry files the same day.
	PlacedAt time.Time
}

// SaleCancel is a cancelled order as settlement_service needs it.
type SaleCancel struct {
	TeamID  uint64
	ShopID  uint64
	OrderID uint64

	// Who cancelled it.
	ActorID uint64

	// WHEN THE CANCEL HAPPENED — the instant `setOrderStatus` wrote onto the row, never the clock at call
	// time. The cancel's idempotency key is derived from this date
	// (#the-cancel-key-is-order-plus-act-date), so a retry that crosses midnight still produces the SAME
	// key instead of crediting the account twice.
	CancelledAt time.Time
}

// SettlementPoster opens and cancels an order's marketplace settlement account
// (settlement #order-service-calls-settlement).
//
// An INTERFACE THIS SERVICE OWNS, for the same reason StockPicker and CreditChecker are: selling_service
// never imports settlement_service, and the adapter lives in the composition root.
//
// ⚠ BOTH ARE CALLED AFTER THE ORDER'S TRANSACTION COMMITS, AND NEITHER CAN FAIL THE ORDER
// (#the-order-commits-without-settlement). `initial_total` records a sale that already happened on the
// marketplace — refusing the order would lose the only record of it. A failure is logged and repaired by
// hand on the order detail page (#a-missing-account-is-fixed-by-hand).
type SettlementPoster interface {
	OpenSale(ctx context.Context, sale SaleOpening) error
	CancelSale(ctx context.Context, cancel SaleCancel) error
}

// noSettlement is what a Service built without a poster uses: nothing is recorded.
//
// Placing an order must not depend on a downstream ledger being wired up, and a unit test about shops
// should not have to construct one. It is NOT the production default — the composition root wires the
// real one.
type noSettlement struct{}

func (noSettlement) OpenSale(context.Context, SaleOpening) error {
	return nil
}

func (noSettlement) CancelSale(context.Context, SaleCancel) error {
	return nil
}
