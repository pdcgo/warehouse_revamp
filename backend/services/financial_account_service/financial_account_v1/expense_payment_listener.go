package financial_account_v1

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// ExpensePaymentHandler is the listener that posts an EXPENSE on the account it names as having paid —
// expense_service's `ExpenseCreated` and `ExpenseAdjusted` (an-expense-must-name-the-account-that-paid,
// a-correction-follows-the-expenses-account). `expense` and `ads_expense` are broker-only, and this is their one way in
// (one-way-in-per-type).
//
//   - The type: `ads_expense` for an ADS expense, `expense` for every other kind (ads-expense-joins-the-types).
//   - Created: the amount OUT of the paying account.
//   - Adjusted: the signed correction, the opposite way — a correction down gives money back, a correction up takes
//     more, and Batalkan (minus the net) gives the whole net back. Always the ORIGINAL expense's account, which the
//     event carries (every-correction-is-a-signed-adjustment).
//   - The day: the expense's own day, as the person chose it — an adjustment carries the corrected expense's day
//     (an-adjustment-counts-on-the-day-it-fixes), so a correction lands where the payment did.
//   - Account 0 (an expense made before *Paid from*, and its corrections) and a STOCK_LOSS post NOTHING — acked with
//     the claim. expense_service never publishes them; this is the listener not trusting that.
//
// Every event carries its own delta, so the rows COMMUTE: a correction delivered before its expense still leaves the
// account at the same balance once both have arrived.
//
// It follows the handler contract (one-contract-for-both-handler-types), as RestockPaymentHandler: one event, its own
// transaction, the event id CLAIMED inside it beside the write — a redelivery posts nothing, and a failure rolls the
// claim back with the post, so the redelivery genuinely retries.
func (s *Service) ExpensePaymentHandler() event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		switch variant := event.GetMessage().(type) {
		case *eventsv1.Event_ExpenseCreated:
			created := variant.ExpenseCreated

			return s.postExpense(ctx, event, expenseLeg{
				teamID:      created.GetTeamId(),
				accountID:   created.GetFinanceAccountId(),
				kind:        created.GetKind(),
				change:      -float64(created.GetAmount()),
				day:         created.GetOccurredOn(),
				actorID:     created.GetActorId(),
				isOverride:  created.GetActorIsOverride(),
				description: fmt.Sprintf("Expense E-%d", created.GetExpenseId()),
			})
		case *eventsv1.Event_ExpenseAdjusted:
			adjusted := variant.ExpenseAdjusted

			return s.postExpense(ctx, event, expenseLeg{
				teamID:      adjusted.GetTeamId(),
				accountID:   adjusted.GetFinanceAccountId(),
				kind:        adjusted.GetKind(),
				change:      -float64(adjusted.GetAmount()),
				day:         adjusted.GetOccurredOn(),
				actorID:     adjusted.GetActorId(),
				isOverride:  adjusted.GetActorIsOverride(),
				description: fmt.Sprintf("Expense E-%d adjusted", adjusted.GetExpenseId()),
			})
		default:
			// A variant this listener does not post. ACKed: redelivering what nothing here will ever handle is a
			// loop, not a retry. The subscriptions' event_type filters keep it from arriving at all.
			return nil
		}
	}
}

// expenseLeg is the one row an expense event posts.
type expenseLeg struct {
	teamID      uint64
	accountID   uint64
	kind        expensev1.ExpenseKind
	change      float64
	day         string
	actorID     uint64
	isOverride  bool
	description string
}

// postExpense claims the event and posts its row, the account LOCKED first (the ledger's one lock rule).
//
// An account that is missing, or not the expense team's, is an error and NOT acked: expense_service checked the account
// when the expense was recorded, so a mismatch is a bug worth a dead letter, never money to file somewhere else. An
// ARCHIVED account still posts (my spec, as for a withdrawal and a restock): an expense recorded while it was active
// may be corrected after it was archived, and refusing would dead-letter money that moved.
func (s *Service) postExpense(ctx context.Context, event *eventsv1.Event, leg expenseLeg) error {
	if leg.accountID == 0 || leg.kind == expensev1.ExpenseKind_EXPENSE_KIND_STOCK_LOSS || rupiah(leg.change) == 0 {
		return s.claimOnly(ctx, event)
	}

	changeType := m.ChangeExpense
	if leg.kind == expensev1.ExpenseKind_EXPENSE_KIND_ADS {
		changeType = m.ChangeAdsExpense
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		isNew, err := s.dedup.Claim(ctx, tx, event)
		if err != nil {
			return err
		}

		if !isNew {
			return nil
		}

		locked, err := lockOwnedAccounts(tx, map[uint64]uint64{leg.accountID: leg.teamID})
		if err != nil {
			return fmt.Errorf("financial_account: %s: %w", event.GetEventId(), err)
		}

		_, err = post(tx, locked[leg.accountID], entry{
			changeType:  changeType,
			change:      leg.change,
			description: leg.description,
			occurredAt:  expenseDay(event, leg.day),
			actorID:     leg.actorID,
			isOverride:  leg.isOverride,
		})

		return err
	})
}

// expenseDay is the day the expense belongs to, as the person chose it (YYYY-MM-DD), read as that day in Jakarta — the
// day its daily report row counts on (a-row-counts-on-the-day-the-money-moved). An unreadable day falls back to the
// envelope's clock rather than dead-lettering money that moved.
func expenseDay(event *eventsv1.Event, day string) time.Time {
	at, err := time.ParseInLocation(dateLayout, day, jakarta)
	if err != nil {
		return event.GetOccurredAt().AsTime()
	}

	return at
}
