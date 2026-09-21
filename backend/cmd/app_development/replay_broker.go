package main

import (
	"context"
	"sync"
	"time"

	"cloud.google.com/go/pubsub/v2"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	settlement_service "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// replayBroker gives settlement's replay its subscription: how far back it can redeliver, and a seek.
//
// The window is READ from Pub/Sub on first use and then cached — it is configuration, not a per-request
// fact (#the-replay-is-bounded-by-the-subscription-retention). ⚠ A FAILED read is never cached and never
// defaulted: the replay is refused until the admin API answers.
type replayBroker struct {
	client *pubsub.Client

	mu     sync.Mutex
	window time.Duration
	known  bool
}

func NewReplayBroker(client *pubsub.Client) settlement_v1.ReplayBroker {
	return &replayBroker{client: client}
}

func (b *replayBroker) ReplayWindow(ctx context.Context) (time.Duration, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.known {
		return b.window, nil
	}

	window, err := event_source.SubscriptionReplayWindow(ctx, b.client, devProjectID, settlement_service.FoldSubscription)
	if err != nil {
		return 0, err
	}

	b.window = window
	b.known = true

	return window, nil
}

func (b *replayBroker) Seek(ctx context.Context, to time.Time) error {
	return event_source.SeekSubscription(ctx, b.client, devProjectID, settlement_service.FoldSubscription, to)
}
