package expense_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

// ExpenseVoid stops a cost counting (#169) — it was entered by mistake.
//
// VOIDED, NOT DELETED, following #164: a deleted row cannot tell you a cost was entered and then
// retracted, and somebody looking at a profit figure that changed wants to see why. The row stays on
// the list; every total excludes it.
//
// IDEMPOTENT — voiding twice is a person double-clicking, not an error, and the second call reports
// the row as it stands. The timestamp is NOT moved: "when did this stop counting" must answer with the
// retraction, not with the last time somebody pressed the button.
//
// ⚠ A MISSING ROW IS NotFound HERE, unlike RevenueVoid where it is success. The difference is who
// calls it: RevenueVoid consumes a Pub/Sub event, so a missing row must ACK or the message redelivers
// forever. This is a person clicking a button — if the cost is not there, or belongs to another team,
// saying so is the honest answer rather than a silent success they would read as "done".
func (s *Service) ExpenseVoid(
	ctx context.Context,
	req *connect.Request[expensev1.ExpenseVoidRequest],
) (*connect.Response[expensev1.ExpenseVoidResponse], error) {
	var row expense_service_models.ExpenseRecord

	err := s.db.
		WithContext(ctx).
		// The scope check, and the reason another team's cost is NotFound rather than PermissionDenied.
		Where("id = ? AND team_id = ?", req.Msg.GetExpenseId(), req.Msg.GetTeamId()).
		First(&row).
		Error
	if err != nil {
		return nil, costErr(err)
	}

	if row.VoidedAt == nil {
		now := time.Now()

		updateErr := s.db.
			WithContext(ctx).
			Model(&expense_service_models.ExpenseRecord{}).
			Where("id = ?", row.ID).
			Updates(map[string]any{"voided_at": now, "updated_at": now}).
			Error
		if updateErr != nil {
			return nil, costErr(updateErr)
		}

		row.VoidedAt = &now
	}

	return connect.NewResponse(&expensev1.ExpenseVoidResponse{Expense: costToProto(&row)}), nil
}
