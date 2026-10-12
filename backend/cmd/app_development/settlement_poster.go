package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"time"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// jakarta is the system's calendar (the-system-runs-on-jakarta-time). A fixed +7 rather than a loaded
// zone: WIB has no daylight saving and has not moved since 1988, and a fixed zone needs no tzdata on
// the host.
var jakarta = time.FixedZone("WIB", 7*60*60)

// settlementPoster joins selling_service to settlement_service (settlement #order-service-calls-settlement).
//
// Same shape as liabilityPoster beside it: selling declares the interface in its own terms, and this
// adapter is the whole dependency between the two. It calls settlement's DOMAIN functions in-process —
// no Connect request, no network hop to itself.
//
// ⚠ THE KEY RECIPES LIVE HERE, because the recipe is the CALLER's (#the-recipe-is-the-callers-problem) —
// settlement enforces uniqueness and invents nothing.
type settlementPoster struct {
	settlement *settlement_v1.Service
}

func NewSettlementPoster(settlement *settlement_v1.Service) selling_v1.SettlementPoster {
	return &settlementPoster{settlement: settlement}
}

// OpenSale posts the order's `initial_total` — the marketplace total with the sign flipped, because
// POSITIVE IS MONEY TOWARD US and at this moment the platform owes us the sale.
func (p *settlementPoster) OpenSale(ctx context.Context, sale selling_v1.SaleOpening) error {
	_, err := p.settlement.PostEntry(ctx, settlement_v1.PostInput{
		TeamID:  sale.TeamID,
		ShopID:  sale.ShopID,
		OrderID: sale.OrderID,
		// The same recipe the order's own event uses: derived from the order, so a repeat collides
		// instead of opening a second sale (#the-order-commits-without-settlement).
		UniqueID:       "order-placed:" + strconv.FormatUint(sale.OrderID, 10),
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_ORDER,
		Change:         -sale.MarketplaceTotal,
		OccurredOn:     sale.PlacedAt.In(jakarta).Format(time.DateOnly),
		// The person who placed the order is answerable for its opening row (#actor-id-is-the-pic).
		ActorID:         sale.CreatedByUserID,
		CreatedByUserID: sale.CreatedByUserID,
	})

	return err
}

// CancelSale posts the order's `initial_total_cancel`.
//
// ⚠ NOTHING TO CANCEL IS A NORMAL ANSWER. An order with no marketplace total never opened an account,
// and one whose opening post failed has nothing live — the order's own cancel has committed either way.
func (p *settlementPoster) CancelSale(ctx context.Context, cancel selling_v1.SaleCancel) error {
	day := cancel.CancelledAt.In(jakarta).Format(time.DateOnly)

	_, err := p.settlement.CancelSale(ctx, settlement_v1.CancelInput{
		TeamID:     cancel.TeamID,
		ShopID:     cancel.ShopID,
		OrderID:    cancel.OrderID,
		UniqueID:   cancelKey(cancel.OrderID, day),
		OccurredOn: day,
		ActorID:    cancel.ActorID,
	})
	if errors.Is(err, settlement_v1.ErrNothingToCancel) {
		return nil
	}

	return err
}

// cancelKey is `hash(order_id + act_date + "cancel")` (#the-cancel-key-is-order-plus-act-date).
//
// ⚠ THE DATE IS THE ACT's, never the clock at call time. A key from `now()` is safe only until a retry
// crosses midnight — then it is a new key, and the account is credited twice.
func cancelKey(orderID uint64, actDate string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d|%s|cancel", orderID, actDate)))

	return "order-cancelled:" + hex.EncodeToString(sum[:])
}
