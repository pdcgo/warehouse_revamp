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

	mu     sync.Mutex
	window time.Duration
	known  bool
}

func NewReplayBroker(client *pubsub.Client) settlement_v1.ReplayBroker {
	return &replayBroker{client: client, subscription: settlement_service.FoldSubscription}
}

// NewSupplierReplayBroker is supplier_service's — the subscription that feeds a supplier's figures.
func NewSupplierReplayBroker(client *pubsub.Client) supplier_v1.ReplayBroker {
	return &replayBroker{client: client, subscription: supplier_service.FoldSubscription}
}

func (b *replayBroker) ReplayWindow(ctx context.Context) (time.Duration, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.known {
		return b.window, nil
	}

	window, err := event_source.SubscriptionReplayWindow(ctx, b.client, devProjectID, b.subscription)
	if err != nil {
		return 0, err
	}

	b.window = window
	b.known = true

	return window, nil
}

func (b *replayBroker) Seek(ctx context.Context, to time.Time) error {
	return event_source.SeekSubscription(ctx, b.client, devProjectID, b.subscription, to)
}
