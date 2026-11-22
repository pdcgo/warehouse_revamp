package main

import (
	"context"
	"sync"
	"time"

	"cloud.google.com/go/pubsub/v2"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	settlement_service "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
	supplier_service "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// replayBroker gives a fold's replay its subscription: how far back it can redeliver, and a seek. One type for every
// fold — settlement's and supplier_service's ReplayBroker are the same two methods, each service declaring its own.
//
// The window is READ from Pub/Sub on first use and then cached — it is configuration, not a per-request
// fact (#the-replay-is-bounded-by-the-subscription-retention). ⚠ A FAILED read is never cached and never
// defaulted: the replay is refused until the admin API answers.
type replayBroker struct {
	client       *pubsub.Client
	subscription string
	// More subscriptions feeding the SAME fold — each is seeked too, and the window is the shortest of all.
	also []string

	mu     sync.Mutex
	window time.Duration
	known  bool
}

func NewReplayBroker(client *pubsub.Client) settlement_v1.ReplayBroker {
	return &replayBroker{client: client, subscription: settlement_service.FoldSubscription}
}

// NewSupplierReplayBroker is supplier_service's — every subscription that feeds a supplier's two reports: the accepts and
// the received-count corrections (a-received-count-correction-counts-on-its-own-day) for the restock figures, the
// placements and the cancels for Penjualan (penjualan-is-the-selling-value-on-the-order-day). A replay deletes the days'
// rows of BOTH reports, so it must seek ALL FOUR, or a report's moves would be lost — and its window is the shortest.
func NewSupplierReplayBroker(client *pubsub.Client) supplier_v1.ReplayBroker {
	return &replayBroker{
		client:       client,
		subscription: supplier_service.FoldSubscription,
		also: []string{
			supplier_service.CountCorrectedSubscription,
			supplier_service.SalesPlacedSubscription,
			supplier_service.SalesCancelledSubscription,
		},
	}
}

func (b *replayBroker) ReplayWindow(ctx context.Context) (time.Duration, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.known {
		return b.window, nil
	}

	window, err := event_source.SubscriptionReplayWindow(ctx, b.client, b.client.Project(), b.subscription)
	if err != nil {
		return 0, err
	}

	for _, sub := range b.also {
		other, otherErr := event_source.SubscriptionReplayWindow(ctx, b.client, b.client.Project(), sub)
		if otherErr != nil {
			return 0, otherErr
		}

		window = min(window, other)
	}

	b.window = window
	b.known = true

	return window, nil
}

func (b *replayBroker) Seek(ctx context.Context, to time.Time) error {
	err := event_source.SeekSubscription(ctx, b.client, b.client.Project(), b.subscription, to)
	if err != nil {
		return err
	}

	for _, sub := range b.also {
		err = event_source.SeekSubscription(ctx, b.client, b.client.Project(), sub, to)
		if err != nil {
			return err
		}
	}

	return nil
}
