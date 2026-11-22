package financial_account_v1

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// ExpensePaymentHandler is the listener that posts an EXPENSE on the account it names as having paid —
// expense_service's `ExpenseCreated` and `ExpenseAdjusted` (an-expense-must-name-the-account-that-paid,
// a-correction-follows-the-expenses-account). `expense` and `ads_expense` are broker-only, and this is their one way in
// (one-way-in-per-type).
//
//   - The change type, by the expense's TYPE (expenseChangeOf): `ads_expense` for the Iklan group
//     (ads-expense-joins-the-types); `capital` for Prive and Setoran modal — the same row Setor / Tarik Modal writes
//     (prive-and-deposit-on-pengeluaran-are-the-accounts-capital); `money_in` for Piutang luar diterima and Uang masuk
//     lain (money-in-on-biaya-is-its-own-change-type); `expense` for every other type, and for an expense from before
//     the types (its kind only).
//   - Created: the amount OUT of the paying account — or INTO it for a money-in type (Setoran modal included).
//   - Adjusted: the signed correction, the same way round — for money out a correction down gives money back, a
//     correction up takes more, and Batalkan (minus the net) gives the whole net back; for money in each sign is the
//     other way. Always the ORIGINAL expense's account and type, which the event carries
//     (every-correction-is-a-signed-adjustment) — one rule.
//   - The row names the EXPENSE it came from (`expense_id`) — the history's *dari Biaya #N*.
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
				expenseType: created.GetType(),
				expenseID:   created.GetExpenseId(),
				amount:      created.GetAmount(),
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
				expenseType: adjusted.GetType(),
				expenseID:   adjusted.GetExpenseId(),
				amount:      adjusted.GetAmount(),
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
	expenseType expensev1.ExpenseType
	expenseID   uint64
	// As the event carries it: positive on an expense, signed on a correction — money-out's sign; expenseChangeOf turns
	// it into the account's change.
	amount      float64
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
	if leg.accountID == 0 || leg.kind == expensev1.ExpenseKind_EXPENSE_KIND_STOCK_LOSS || san_money.IsZero(leg.amount) {
		return s.claimOnly(ctx, event)
	}

	changeType, change := expenseChangeOf(leg.kind, leg.expenseType, leg.amount)

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
			change:      change,
			description: leg.description,
			occurredAt:  expenseDay(event, leg.day),
			actorID:     leg.actorID,
			isOverride:  leg.isOverride,
			expenseID:   leg.expenseID,
		})

		return err
	})
}

// expenseChangeOf is the account's row for an expense event — its change type and signed change — from the expense's
// kind (its group) and type, the expense types' accepted table (the-expense-types-prototype-is-accepted):
//
//	type                                         change type    change
//	the Iklan group (any type, or none)          ads_expense    −amount
//	PRIVE                                        capital        −amount
//	CAPITAL_DEPOSIT                              capital        +amount
//	OUTSIDE_RECEIVABLE_RECEIVED, OTHER_IN        money_in       +amount
//	every other type, and none                   expense        −amount
//
// `amount` is the event's: an expense's positive amount, or a correction's signed one — so a correction posts the same
// change type, the same way round.
func expenseChangeOf(kind expensev1.ExpenseKind, t expensev1.ExpenseType, amount float64) (string, float64) {
	switch t {
	case expensev1.ExpenseType_EXPENSE_TYPE_PRIVE:
		return m.ChangeCapital, -amount
	case expensev1.ExpenseType_EXPENSE_TYPE_CAPITAL_DEPOSIT:
		return m.ChangeCapital, amount
	case expensev1.ExpenseType_EXPENSE_TYPE_OUTSIDE_RECEIVABLE_RECEIVED, expensev1.ExpenseType_EXPENSE_TYPE_OTHER_IN:
		return m.ChangeMoneyIn, amount
	}

	if kind == expensev1.ExpenseKind_EXPENSE_KIND_ADS {
		return m.ChangeAdsExpense, -amount
	}

	return m.ChangeExpense, -amount
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
