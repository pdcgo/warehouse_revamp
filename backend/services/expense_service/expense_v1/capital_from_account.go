package expense_v1

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

// CAPITAL'S SECOND DOOR (prive-and-deposit-on-pengeluaran-are-the-accounts-capital — one act, one record, two doors;
// the-expense-types-prototype-is-accepted). A SELLING team's Setor / Tarik Modal made on the account page is the same
// one record as Biaya's Setoran modal / Prive: financial_account_service posts its `capital` row by hand, as it always
// has, and tells the broker (FinancialAccountCapitalRecorded); this records it here —
//
//   - type Setoran modal (money put in, a plus change) or Prive (taken out, a minus change), its group Lainnya;
//   - origin ACCOUNT_PAGE — the Biaya row's *Dicatat di halaman akun*; the account row keeps *manual · who*;
//   - the amount, the day, who (and the override mark) and the account exactly as the account row has them, its
//     recorded-on the row's;
//   - linked to the account row (`account_log_id`, UNIQUE) — one account row is one expense, whoever brings it;
//   - and NOTHING is published: the account row is the act's own, so the account listener never posts a second capital
//     row for it. A later Adjust / Batalkan on Biaya is an ordinary correction (ExpenseAdjusted) and posts its signed
//     capital row on the same account, as any typed row's does.
//
// A WAREHOUSE team's (or a team on neither side) is dropped — its Setor / Tarik Modal stays on the account page alone
// (Biaya is the selling team's). Which side a team sits on is asked of team_service (TeamSides) BEFORE the transaction.
//
// Two ways in, one function (recordCapital): the listener (claims the event in the same transaction — a redelivery
// records nothing) and the one-time import `san expense import-capital` (ImportCapital — the account rows made before
// this door existed, built into the very message the door publishes). Either way the unique link makes a second
// arrival of the same account row a no-op, so the import can run beside the live door, and twice.

// CapitalFromAccountHandler is the listener on FinancialAccountCapitalRecorded. It follows the handler contract
// (one-contract-for-both-handler-types): one event, its own transaction, the event id claimed inside it beside the
// write. A failure is returned (NACK) so the broker retries; another variant is acked.
func (s *Service) CapitalFromAccountHandler() event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		recorded := event.GetFinancialAccountCapitalRecorded()
		if recorded == nil {
			return nil
		}

		side, err := s.sides.SideOf(ctx, recorded.GetTeamId())
		if err != nil {
			return fmt.Errorf("expense: %s: ask the team's side: %w", event.GetEventId(), err)
		}

		_, err = s.recordCapital(ctx, event, side, true)

		return err
	}
}

// ImportResult counts what ImportCapital did.
type ImportResult struct {
	// Imported: account rows now on Biaya.
	Imported int
	// Already: rows Biaya already held (the live door, or an earlier import).
	Already int
	// NotSelling: a warehouse team's (or neither side's) — left on the account page alone.
	NotSelling int
}

// ImportCapital brings account-page capital rows into Biaya — the one-time import of the acts made before the second
// door (`san expense import-capital`), each built by the account service into the message the door publishes
// (financial_account_v1.HandCapitalEvents). Idempotent by the unique link, not by the claim table: a row already
// recorded — by the door or an earlier run — is counted, never written twice. A team's side is asked once per team.
func (s *Service) ImportCapital(ctx context.Context, events []*eventsv1.Event) (ImportResult, error) {
	result := ImportResult{}
	sides := map[uint64]TeamSide{}

	for _, event := range events {
		recorded := event.GetFinancialAccountCapitalRecorded()
		if recorded == nil {
			continue
		}

		side, known := sides[recorded.GetTeamId()]
		if !known {
			var err error

			side, err = s.sides.SideOf(ctx, recorded.GetTeamId())
			if err != nil {
				return result, fmt.Errorf("ask team %d's side: %w", recorded.GetTeamId(), err)
			}

			sides[recorded.GetTeamId()] = side
		}

		if side != SideSeller {
			result.NotSelling++

			continue
		}

		written, err := s.recordCapital(ctx, event, side, false)
		if err != nil {
			return result, fmt.Errorf("account row %d: %w", recorded.GetLogId(), err)
		}

		if written {
			result.Imported++
		} else {
			result.Already++
		}
	}

	return result, nil
}

var errNoCapitalRow = errors.New("a capital event names its account row and a change that is not 0")

// recordCapital writes one account-page capital act as its Biaya row — reporting whether it wrote one. `claim` = the
// broker's delivery: the event id is claimed in the same transaction (a redelivery writes nothing). A team that does not
// sell writes nothing (claimed all the same, so it is not redelivered).
func (s *Service) recordCapital(ctx context.Context, event *eventsv1.Event, side TeamSide, claim bool) (bool, error) {
	recorded := event.GetFinancialAccountCapitalRecorded()

	written := false

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if claim {
			isNew, err := s.dedup.Claim(ctx, tx, event)
			if err != nil {
				return err
			}

			if !isNew {
				return nil
			}
		}

		if side != SideSeller {
			return nil
		}

		row, err := capitalExpenseOf(recorded)
		if err != nil {
			return err
		}

		// ONE expense per account row: a second arrival of the same row (a republish under another event id, the
		// import beside the door) finds it and writes nothing.
		result := tx.
			Clauses(clause.OnConflict{
				Columns:     []clause.Column{{Name: "account_log_id"}},
				TargetWhere: clause.Where{Exprs: []clause.Expression{clause.Expr{SQL: "account_log_id > 0"}}},
				DoNothing:   true,
			}).
			Create(&row)
		if result.Error != nil {
			return result.Error
		}

		if result.RowsAffected == 0 {
			return nil
		}

		written = true

		// The Analytic report, in the same transaction — Modal masuk / keluar on the act's day.
		return foldMetric(tx, &row, side)
	})
	if err != nil {
		return false, err
	}

	return written, nil
}

// capitalExpenseOf is the Biaya row an account-page capital act IS: Setoran modal for money put in, Prive for money taken
// out — the type's group, the amount positive (the type says the direction), the account row's day, note, who, override
// mark and recorded-on, the link to the row.
func capitalExpenseOf(recorded *eventsv1.FinancialAccountCapitalRecorded) (expense_service_models.ExpenseRecord, error) {
	change := recorded.GetChange()
	if recorded.GetLogId() == 0 || san_money.IsZero(change) || math.IsNaN(change) || math.IsInf(change, 0) {
		return expense_service_models.ExpenseRecord{}, errNoCapitalRow
	}

	t := expensev1.ExpenseType_EXPENSE_TYPE_CAPITAL_DEPOSIT
	if change < 0 {
		t = expensev1.ExpenseType_EXPENSE_TYPE_PRIVE
	}

	info, _ := typeInfoOf(t)

	day, err := parseDate(recorded.GetOccurredOn())
	if err != nil {
		return expense_service_models.ExpenseRecord{}, err
	}

	// Recorded when the account row was — unknown (0) reads as now, GORM's own stamp.
	var recordedAt time.Time
	if recorded.GetCreatedAtUnix() > 0 {
		recordedAt = time.Unix(recorded.GetCreatedAtUnix(), 0)
	}

	return expense_service_models.ExpenseRecord{
		TeamID:           recorded.GetTeamId(),
		Kind:             int32(info.group),
		Type:             int32(t),
		Amount:           math.Abs(change),
		OccurredAt:       day,
		Note:             recorded.GetNote(),
		CreatedBy:        recorded.GetActorId(),
		IsOverride:       recorded.GetActorIsOverride(),
		FinanceAccountID: recorded.GetAccountId(),
		Origin:           int32(expensev1.ExpenseOrigin_EXPENSE_ORIGIN_ACCOUNT_PAGE),
		AccountLogID:     recorded.GetLogId(),
		CreatedAt:        recordedAt,
		UpdatedAt:        recordedAt,
	}, nil
}
