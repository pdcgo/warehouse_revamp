package event_source

import (
	"context"
	"fmt"
	"time"

	"cloud.google.com/go/pubsub/v2"
	"cloud.google.com/go/pubsub/v2/apiv1/pubsubpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// SubscriptionReplayWindow reads how far back a subscription can still REDELIVER, from Pub/Sub's own
// configuration — never a constant (settlement #the-replay-is-bounded-by-the-subscription-retention).
//
// A seek to a time can reach a message only while something still holds it:
//
//   - the TOPIC's retention, which keeps every message regardless of acknowledgement — InitializeTopic
//     sets it to Pub/Sub's 31-day maximum; and
//   - the SUBSCRIPTION's retention, but only for ACKNOWLEDGED messages when retain_acked_messages is on.
//
// The window is the larger of the two that apply. ZERO means a seek backwards would deliver NOTHING — a
// replay would become a pure delete — and the caller must refuse.
//
// ⚠ An error is returned as it is. A guard that falls back to a default when the admin API is down is a
// guard that guesses, and a guess here deletes report days nothing can rebuild.
func SubscriptionReplayWindow(
	ctx context.Context,
	client *pubsub.Client,
	projectID string,
	subscriptionID string,
) (time.Duration, error) {
	sub, err := client.SubscriptionAdminClient.GetSubscription(ctx, &pubsubpb.GetSubscriptionRequest{
		Subscription: subscriptionPath(projectID, subscriptionID),
	})
	if err != nil {
		return 0, fmt.Errorf("event_source: cannot read subscription %s: %w", subscriptionID, err)
	}

	window := sub.GetTopicMessageRetentionDuration().AsDuration()

	if sub.GetRetainAckedMessages() {
		own := sub.GetMessageRetentionDuration().AsDuration()
		if own > window {
			window = own
		}
	}

	return window, nil
}

// SeekSubscription marks every message published at or after `to` as UNACKNOWLEDGED, so the subscription
// redelivers them through its normal route.
//
// ⚠ ASYNCHRONOUS in effect. It returns once the seek is accepted; the messages arrive over the following
// minutes, and nothing here can say when the last one has.
func SeekSubscription(
	ctx context.Context,
	client *pubsub.Client,
	projectID string,
	subscriptionID string,
	to time.Time,
) error {
	_, err := client.SubscriptionAdminClient.Seek(ctx, &pubsubpb.SeekRequest{
		Subscription: subscriptionPath(projectID, subscriptionID),
		Target:       &pubsubpb.SeekRequest_Time{Time: timestamppb.New(to)},
	})
	if err != nil {
		return fmt.Errorf("event_source: cannot seek subscription %s: %w", subscriptionID, err)
	}

	return nil
}
