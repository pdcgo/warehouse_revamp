package settlement_v1

import (
	"context"

	"connectrpc.com/connect"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// OrderSettlementDetail serves the panel on the order detail page: one account and its WHOLE log.
//
// ⚠ THE LOG IS NOT PAGINATED, and that is a bounded choice rather than an oversight of HARD RULE 9.
// That rule governs lists that grow with the DATA; this one grows with a single order's settlement
// activity — a handful of rows. The panel also draws a running balance downward, which a page
// boundary would cut in half, leaving a column of numbers that do not add up on screen.
func (s *Service) OrderSettlementDetail(
	ctx context.Context,
	req *connect.Request[settlementv1.OrderSettlementDetailRequest],
) (*connect.Response[settlementv1.OrderSettlementDetailResponse], error) {
	msg := req.Msg

	var state settlement_service_models.OrderSettlement

	err := s.db.WithContext(ctx).
		Where("order_id = ?", msg.GetOrderId()).
		Limit(1).
		Find(&state).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	// ⚠ ABSENT IS NOT EMPTY. An order with no account has never been settled at all, which is a
	// different statement from "settled to zero" — and the screens must say so rather than render a
	// zero row that reads as a completed settlement.
	if state.OrderID == 0 {
		return nil, errNoAccount
	}

	// The scope proves the caller belongs to the team it named; this proves the ACCOUNT does. Without
	// it, knowing an order id would be enough to read another team's ledger.
	if state.TeamID != msg.GetTeamId() {
		return nil, errWrongTeam
	}

	var logs []settlement_service_models.SettlementLog

	err = s.db.WithContext(ctx).
		Where("order_id = ?", msg.GetOrderId()).
		// OLDEST FIRST, so the running `balance` column reads downward the way it was built. Newest
		// first would show a running total that appears to count backwards.
		Order("id ASC").
		Find(&logs).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	entries := make([]*settlementv1.SettlementEntry, 0, len(logs))
	for i := range logs {
		entries = append(entries, entryToProto(&logs[i], ""))
	}

	return connect.NewResponse(&settlementv1.OrderSettlementDetailResponse{
		Settlement: settlementToProto(&state),
		Entries:    entries,
	}), nil
}
