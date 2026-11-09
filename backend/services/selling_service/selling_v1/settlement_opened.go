package selling_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// SettlementOpened stamps WHEN THE ORDER'S SETTLEMENT ACCOUNT OPENED (a-missing-account-is-found-by-its-opened-at):
// `orders.settlement_opened_at`, the column OrderList's `settlement_not_opened` filter reads. It is a Go method reached
// in-process by settlement through the composition root (settlement_opened_marker.go) — NOT an RPC: the order service
// owns the row, settlement knows the moment, and no browser may claim an account opened.
//
// ONCE, AND THE FIRST TIME WINS. `settlement_opened_at IS NULL` in the UPDATE makes a second stamp — a redelivered Order
// Placed, a retried post, a correction re-posting the sale — a no-op, so the column keeps the first opening. An order
// that does not exist is no error: nothing here may refuse settlement's post after it committed.
func (s *Service) SettlementOpened(ctx context.Context, orderID uint64, openedAt time.Time) error {
	err := s.db.
		WithContext(ctx).
		Model(&selling_service_models.Order{}).
		Where("id = ? AND settlement_opened_at IS NULL", orderID).
		UpdateColumn("settlement_opened_at", openedAt).
		Error
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	return nil
}
