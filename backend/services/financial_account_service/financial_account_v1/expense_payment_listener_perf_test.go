//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ExpensePaymentHandler -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
)

// One ADS expense paid out of an account a year deep, dated a week back — the listener's claim, lock, post and the shift
// of every later day. Then a correction of it on the same day: the same path with the opposite sign.
func TestPerf_ExpensePaymentHandler(t *testing.T) {
	b := perfSetup(t)
	weekAgo := time.Now().Add(-7 * 24 * time.Hour).In(time.FixedZone("WIB", 7*60*60)).Format("2006-01-02")

	perfRun(t, b, "ExpensePaymentHandler/created", func(i int) error {
		return b.svc.ExpensePaymentHandler()(context.Background(), &eventsv1.Event{
			EventId:     fmt.Sprintf("perf-ec-%d", i),
			OccurredAt:  timestamppb.Now(),
			AggregateId: "expense:perf",
			Message: &eventsv1.Event_ExpenseCreated{ExpenseCreated: &eventsv1.ExpenseCreated{
				ExpenseId: uint64(90_000 + i + 1), TeamId: b.team, Kind: expensev1.ExpenseKind_EXPENSE_KIND_ADS,
				FinanceAccountId: b.busy, Amount: 120_000, OccurredOn: weekAgo, ActorId: ani,
			}},
		})
	})

	perfRun(t, b, "ExpensePaymentHandler/adjusted", func(i int) error {
		return b.svc.ExpensePaymentHandler()(context.Background(), &eventsv1.Event{
			EventId:     fmt.Sprintf("perf-ea-%d", i),
			OccurredAt:  timestamppb.Now(),
			AggregateId: "expense:perf",
			Message: &eventsv1.Event_ExpenseAdjusted{ExpenseAdjusted: &eventsv1.ExpenseAdjusted{
				AdjustmentId: uint64(91_000 + i + 1), ExpenseId: uint64(90_000 + i + 1), TeamId: b.team,
				Kind: expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, FinanceAccountId: b.busy, Amount: -20_000,
				OccurredOn: weekAgo, ActorId: ani,
			}},
		})
	})
}
