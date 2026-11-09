//go:build perfaudit

// go test -tags perfaudit -run TestPerf_TransferShippingHandler -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
)

// One transfer's shipping paid out of an account a year deep, opened a week back — the listener's claim, lock, post
// and the shift of every later day. Then an edit that MOVES the cost between two of the team's accounts: two locks in
// one statement, two posts, two shifts. The same path as RestockPaymentHandler (postPaymentLegs), as `expense`.
func TestPerf_TransferShippingHandler(t *testing.T) {
	b := perfSetup(t)
	weekAgo := time.Now().Add(-7 * 24 * time.Hour)
	other := b.accounts[1].ID

	perfRun(t, b, "TransferShippingHandler/created", func(i int) error {
		return b.svc.TransferShippingHandler()(context.Background(), &eventsv1.Event{
			EventId:     fmt.Sprintf("perf-tc-%d", i),
			OccurredAt:  timestamppb.New(weekAgo),
			AggregateId: "warehouse-transfer:perf",
			Message: &eventsv1.Event_WarehouseTransferCreated{WarehouseTransferCreated: &eventsv1.WarehouseTransferCreated{
				TransferId: uint64(90_000 + i + 1), TeamId: b.team, FinanceAccountId: b.busy,
				Amount: 18_000, ActorId: ani, CreatedAtUnix: weekAgo.Unix(),
			}},
		})
	})

	perfRun(t, b, "TransferShippingHandler/moved", func(i int) error {
		return b.svc.TransferShippingHandler()(context.Background(), &eventsv1.Event{
			EventId:     fmt.Sprintf("perf-tm-%d", i),
			OccurredAt:  timestamppb.New(weekAgo),
			AggregateId: "warehouse-transfer:perf",
			Message: &eventsv1.Event_WarehouseTransferUpdated{WarehouseTransferUpdated: &eventsv1.WarehouseTransferUpdated{
				TransferId: uint64(91_000 + i + 1), TeamId: b.team,
				OldFinanceAccountId: b.busy, NewFinanceAccountId: other,
				OldAmount: 18_000, NewAmount: 20_000, ActorId: ani, UpdatedAtUnix: weekAgo.Unix(),
			}},
		})
	})
}
