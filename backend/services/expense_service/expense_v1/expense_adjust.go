package expense_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

// ExpenseAdjust corrects an expense with a NEW ROW — the one way an expense is corrected
// (every-correction-is-a-signed-adjustment). The expense itself never changes (an-expense-is-never-edited), so the
// mistake and its correction both stay on the list, each saying who wrote it and when.
//
//   - The adjustment copies the expense's team, shop, kind and DAY, never typed — so it counts in the month that holds
//     the mistake (an-adjustment-counts-on-the-day-it-fixes), and every total and the daily statement just sum rows.
//   - It corrects an EXPENSE, never another adjustment: a mistaken adjustment is fixed by a second one on the same
//     expense.
//   - An expense and its adjustments never sum below 0 — a correction cannot turn a cost into income.
//
// ⚠ THE EXPENSE ROW IS LOCKED for the check and the write. Two corrections of one expense at once — two people pressing
// Batalkan — would each read the same net and both pass the floor; under the lock the second one reads the first's row
// and is refused.
//
// A missing expense, or another team's, is NotFound: a person clicked a button, and the honest answer is that it is not
// there.
func (s *Service) ExpenseAdjust(
	ctx context.Context,
	req *connect.Request[expensev1.ExpenseAdjustRequest],
) (*connect.Response[expensev1.ExpenseAdjustResponse], error) {
	msg := req.Msg

	// Re-checked rather than trusted from the validation: a caller that skips the interceptor (a test, a command) must
	// not write a correction of nothing — the database would refuse it, as a less useful error.
	if msg.GetAmount() == 0 {
		return nil, costErr(errZeroCorrection)
	}

	var (
		expense    expense_service_models.ExpenseRecord
		adjustment expense_service_models.ExpenseRecord
		net        int64
	)

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// The scope check, and the reason another team's cost is NotFound rather than PermissionDenied.
		err := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND team_id = ?", msg.GetExpenseId(), msg.GetTeamId()).
			First(&expense).
			Error
		if err != nil {
			return err
		}

		if expense.AdjustsExpenseID != 0 {
			return errAdjustsAnAdjustment
		}

		adjusted, err := adjustedSums(tx, []uint64{expense.ID})
		if err != nil {
			return err
		}

		net = expense.Amount + adjusted[expense.ID] + msg.GetAmount()
		if net < 0 {
			return errBelowZero
		}

		adjustment = expense_service_models.ExpenseRecord{
			TeamID:           expense.TeamID,
			ShopID:           expense.ShopID,
			Kind:             expense.Kind,
			Amount:           msg.GetAmount(),
			OccurredAt:       expense.OccurredAt,
			Note:             msg.GetNote(),
			CreatedBy:        actorFrom(ctx),
			IsOverride:       overrideFrom(ctx),
			AdjustsExpenseID: expense.ID,
		}

		return tx.Create(&adjustment).Error
	})
	if err != nil {
		return nil, costErr(err)
	}

	return connect.NewResponse(&expensev1.ExpenseAdjustResponse{
		Adjustment: costToProto(&adjustment, 0),
		Expense:    costToProto(&expense, net),
	}), nil
}
