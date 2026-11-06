package expense_v1

import (
	"context"
	"fmt"
	"math"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

// ExpenseAdjust corrects an expense with a NEW ROW — the one way an expense is corrected
// (every-correction-is-a-signed-adjustment). The expense itself never changes (an-expense-is-never-edited), so the
// mistake and its correction both stay on the list, each saying who wrote it and when.
//
//   - The adjustment copies the expense's team, shop, kind and DAY, never typed — so it counts in the month that holds
//     the mistake (an-adjustment-counts-on-the-day-it-fixes), and every total and the daily statement just sum rows.
//   - It copies the expense's ACCOUNT too (a-correction-follows-the-expenses-account): after the commit it is published
//     (ExpenseAdjusted) and that account gets the signed difference — a correction down gives money back, a cancel the
//     whole net. An expense made before *Paid from* names none, so its corrections post nothing.
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
//
// ANALYTIC — THE CORRECTION'S OWN DAY (an-expense-correction-counts-on-the-day-it-is-made,
// an-expense-correction-counts-for-who-made-it): the adjustment adds its signed amount to the `expense_metric_daily_reports`
// row of the Jakarta day it is MADE and of the person who MADE it, in the same transaction (foldMetric) — so 14 Oct keeps
// its Rp 500.000 and 20 Oct reads the −450.000. The expense's own day above is unchanged for the Expenses page, the
// statement and the paying account. A correction of a STOCK_LOSS adds nothing there.
func (s *Service) ExpenseAdjust(
	ctx context.Context,
	req *connect.Request[expensev1.ExpenseAdjustRequest],
) (*connect.Response[expensev1.ExpenseAdjustResponse], error) {
	msg := req.Msg

	// Re-checked rather than trusted from the validation: a caller that skips the interceptor (a test, a command) must
	// not write a correction of nothing — the database would refuse it, as a less useful error.
	// THE FREEZE POINT, exact as typed (the-backend-never-rounds-money). NaN/Inf never get this far through the
	// interceptor (finite); a direct caller's is refused below, as is a correction of nothing (0, or float dust).
	amount := msg.GetAmount()
	if san_money.IsZero(amount) || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return nil, costErr(errZeroCorrection)
	}

	// Where the team's expenses sit in Analytic — the expense is the scoped team's, so it is asked for that team, BEFORE
	// the transaction (no round-trip under the expense row's lock).
	side, err := s.sides.SideOf(ctx, msg.GetTeamId())
	if err != nil {
		return nil, costErr(fmt.Errorf("ask the team's side: %w", err))
	}

	var (
		expense    expense_service_models.ExpenseRecord
		adjustment expense_service_models.ExpenseRecord
		net        float64
	)

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
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

		net = expense.Amount + adjusted[expense.ID] + amount
		if net < 0 {
			return errBelowZero
		}

		adjustment = expense_service_models.ExpenseRecord{
			TeamID:           expense.TeamID,
			ShopID:           expense.ShopID,
			Kind:             expense.Kind,
			Amount:           amount,
			OccurredAt:       expense.OccurredAt,
			Note:             msg.GetNote(),
			CreatedBy:        actorFrom(ctx),
			IsOverride:       overrideFrom(ctx),
			AdjustsExpenseID: expense.ID,
			FinanceAccountID: expense.FinanceAccountID,
			// When it was MADE — the day it counts on in Analytic.
			CreatedAt: s.now(),
		}

		err = tx.Create(&adjustment).Error
		if err != nil {
			return err
		}

		// The Analytic report, on the correction's own day — the last lock of the transaction, after the expense row's.
		return foldMetric(tx, &adjustment, side)
	})
	if err != nil {
		return nil, costErr(err)
	}

	// AFTER the commit: the expense's account hears the correction.
	if moves(&adjustment) {
		s.publishMoney(ctx, expenseAdjustedEvent(&adjustment))
	}

	return connect.NewResponse(&expensev1.ExpenseAdjustResponse{
		Adjustment: costToProto(&adjustment, 0),
		Expense:    costToProto(&expense, net),
	}), nil
}
