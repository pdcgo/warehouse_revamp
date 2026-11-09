package expense_v1

import (
	"context"
	"log/slog"
	"strconv"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

// THE EXPENSE'S MONEY EVENTS, for the account that paid (an-expense-must-name-the-account-that-paid,
// a-correction-follows-the-expenses-account). Expense announces; financial_account_service posts. Each is published
// AFTER its commit, never inside it, and a failed publish is logged with its event_id rather than failing the expense
// that already committed — the same no-outbox rule as a restock's payment (no-outbox-the-publish-is-trusted).

// moves reports whether a row moves an account at all: a STOCK_LOSS moves no cash (inventory posts it), and an expense
// made before *Paid from* — or an adjustment of one — names no account to move.
func moves(row *expense_service_models.ExpenseRecord) bool {
	return row.FinanceAccountID != 0 && expensev1.ExpenseKind(row.Kind) != expensev1.ExpenseKind_EXPENSE_KIND_STOCK_LOSS
}

// expenseCreatedEvent announces an expense recorded — the money left the paying account.
func expenseCreatedEvent(row *expense_service_models.ExpenseRecord) *eventsv1.Event {
	ref := strconv.FormatUint(row.ID, 10)

	return &eventsv1.Event{
		// DERIVED, never a fresh UUID: an expense is created once, so a republish collides in the listener's claim.
		EventId:     "expense-created:" + ref,
		OccurredAt:  timestamppb.New(row.CreatedAt),
		AggregateId: "expense:" + ref,
		Message: &eventsv1.Event_ExpenseCreated{ExpenseCreated: &eventsv1.ExpenseCreated{
			ExpenseId:        row.ID,
			TeamId:           row.TeamID,
			Kind:             expensev1.ExpenseKind(row.Kind),
			FinanceAccountId: row.FinanceAccountID,
			Amount:           row.Amount,
			OccurredOn:       row.OccurredAt.Format(dateLayout),
			ShopId:           row.ShopID,
			ActorId:          row.CreatedBy,
			ActorIsOverride:  row.IsOverride,
			CreatedAtUnix:    row.CreatedAt.Unix(),
		}},
	}
}

// expenseAdjustedEvent announces a correction — one per adjustment row, on the expense's aggregate.
func expenseAdjustedEvent(adjustment *expense_service_models.ExpenseRecord) *eventsv1.Event {
	expenseRef := strconv.FormatUint(adjustment.AdjustsExpenseID, 10)

	return &eventsv1.Event{
		EventId:     "expense-adjusted:" + strconv.FormatUint(adjustment.ID, 10),
		OccurredAt:  timestamppb.New(adjustment.CreatedAt),
		AggregateId: "expense:" + expenseRef,
		Message: &eventsv1.Event_ExpenseAdjusted{ExpenseAdjusted: &eventsv1.ExpenseAdjusted{
			AdjustmentId:     adjustment.ID,
			ExpenseId:        adjustment.AdjustsExpenseID,
			TeamId:           adjustment.TeamID,
			Kind:             expensev1.ExpenseKind(adjustment.Kind),
			FinanceAccountId: adjustment.FinanceAccountID,
			Amount:           adjustment.Amount,
			OccurredOn:       adjustment.OccurredAt.Format(dateLayout),
			ShopId:           adjustment.ShopID,
			ActorId:          adjustment.CreatedBy,
			ActorIsOverride:  adjustment.IsOverride,
			CreatedAtUnix:    adjustment.CreatedAt.Unix(),
		}},
	}
}

// publishMoney sends one of the events above after its commit. A failure is logged with the event_id — the account is
// then short this expense until a replay — and never fails the request that already committed.
func (s *Service) publishMoney(ctx context.Context, event *eventsv1.Event) {
	err := s.events(ctx, publishIdentity(ctx), event)
	if err != nil {
		slog.ErrorContext(ctx, "expense committed but its money event was not published — the paying account is "+
			"short this change",
			"event_id", event.GetEventId(),
			"error", err,
		)
	}
}

// publishIdentity is who caused the event: the caller, else the system (an internal call with no user).
func publishIdentity(ctx context.Context) *role_basev1.Identity {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return event_source.SystemIdentity("expense_service")
	}

	return identity
}
