//go:build perfaudit

// go test -tags perfaudit -run TestPerf_RestockPaymentHandler -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
)

// One restock paid out of an account a year deep, raised a week back — the listener's claim, lock, post and the shift
// of every later day. Then an edit that MOVES the payment between two of the team's accounts: two locks in one
// statement, two posts, two shifts.
func TestPerf_RestockPaymentHandler(t *testing.T) {
	b := perfSetup(t)
	weekAgo := time.Now().Add(-7 * 24 * time.Hour)
	other := b.accounts[1].ID

	perfRun(t, b, "RestockPaymentHandler/created", func(i int) error {
		return b.svc.RestockPaymentHandler()(context.Background(), &eventsv1.Event{
			EventId:     fmt.Sprintf("perf-rc-%d", i),
			OccurredAt:  timestamppb.New(weekAgo),
			AggregateId: "restock:perf",
			Message: &eventsv1.Event_RestockCreated{RestockCreated: &eventsv1.RestockCreated{
				RestockId: uint64(80_000 + i + 1), TeamId: b.team, FinanceAccountId: b.busy,
				Amount: 120_000, ActorId: ani, CreatedAtUnix: weekAgo.Unix(),
			}},
		})
	})

	perfRun(t, b, "RestockPaymentHandler/moved", func(i int) error {
		return b.svc.RestockPaymentHandler()(context.Background(), &eventsv1.Event{
			EventId:     fmt.Sprintf("perf-rm-%d", i),
			OccurredAt:  timestamppb.New(weekAgo),
			AggregateId: "restock:perf",
			Message: &eventsv1.Event_RestockUpdated{RestockUpdated: &eventsv1.RestockUpdated{
				RestockId: uint64(81_000 + i + 1), TeamId: b.team,
				OldFinanceAccountId: b.busy, NewFinanceAccountId: other,
				OldAmount: 120_000, NewAmount: 130_000, ActorId: ani, UpdatedAtUnix: weekAgo.Unix(),
			}},
		})
	})
}
