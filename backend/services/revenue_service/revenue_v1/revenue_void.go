package revenue_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	revenuev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/revenue/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/revenue_service/revenue_service_models"
)

// RevenueVoid stops an order's row counting (#164) — it was cancelled, so it earned nothing.
//
// VOIDED, NOT DELETED (owner, 2026-07-21). A deleted row cannot tell you an order was placed and then
// cancelled, and that is exactly what somebody looking at the money wants to see. It mirrors the stock
// ledger, which keeps a cancelled order's PICK rows and nets them (#154) rather than erasing them.
//
// ⚠ IDEMPOTENT, and that is load-bearing rather than tidy. This is driven by a Pub/Sub event, and
// Pub/Sub delivers at least once — so voiding an already-voided row is NORMAL, not an error. Refusing
// it would NACK a message that can never succeed, and Pub/Sub would redeliver it forever.
//
// A missing row is likewise success, not NotFound. An order placed before #153, or one whose publish
// was lost, has nothing to void — and refusing would turn an ordinary gap into a poison message.
func (s *Service) RevenueVoid(
	ctx context.Context,
	req *connect.Request[revenuev1.RevenueVoidRequest],
) (*connect.Response[revenuev1.RevenueVoidResponse], error) {
	var row revenue_service_models.OrderRevenue

	err := s.db.
		WithContext(ctx).
		// The team_id clause IS the scope check — one team can never void another's revenue.
		Where("team_id = ? AND order_id = ?", req.Msg.GetTeamId(), req.Msg.GetOrderId()).
		First(&row).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Nothing to void. Success with no row — see the note above on why this is not NotFound.
			return connect.NewResponse(&revenuev1.RevenueVoidResponse{}), nil
		}

		return nil, revenueErr(err)
	}

	// Already voided: the first delivery did the work. Report the row as it stands rather than moving
	// the timestamp, so "when did this stop counting" keeps answering with the cancel, not the retry.
	if row.VoidedAt == nil {
		now := time.Now()

		updateErr := s.db.
			WithContext(ctx).
			Model(&revenue_service_models.OrderRevenue{}).
			Where("id = ?", row.ID).
			Update("voided_at", now).
			Error
		if updateErr != nil {
			return nil, revenueErr(updateErr)
		}

		row.VoidedAt = &now
	}

	return connect.NewResponse(&revenuev1.RevenueVoidResponse{
		Revenue: orderRevenueToProto(&row),
	}), nil
}
