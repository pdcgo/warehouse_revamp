package event_source

import (
	"slices"
	"strings"
	"testing"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
)

// The set of topics is DERIVED from the proto, not listed anywhere a caller could get it wrong. This
// test is what makes that claim true: add a variant with a topic and it appears here without anybody
// remembering to update a list.
func TestDeclaredTopics(t *testing.T) {
	topics, err := DeclaredTopics()
	if err != nil {
		t.Fatalf("DeclaredTopics: %v", err)
	}

	for _, want := range []string{"order-placed", "order-cancelled"} {
		if !slices.Contains(topics, want) {
			t.Errorf("topics = %v, want it to contain %q", topics, want)
		}
	}

	// One entry per topic, not per variant — two variants sharing a topic must not create it twice.
	seen := map[string]bool{}
	for _, topic := range topics {
		if seen[topic] {
			t.Errorf("topic %q appears twice", topic)
		}

		seen[topic] = true
	}

	if !slices.IsSorted(topics) {
		t.Errorf("topics = %v, want them sorted so a run's output is stable", topics)
	}
}

// Every variant must declare a topic. An empty one is a programming error the provisioning tool has to
// surface, because the alternative is a variant that publishes nowhere and says nothing.
func TestEveryVariantDeclaresATopic(t *testing.T) {
	oneof := (&eventsv1.Event{}).ProtoReflect().Descriptor().Oneofs().ByName("message")
	if oneof == nil {
		t.Fatal("the Event envelope has no message oneof")
	}

	fields := oneof.Fields()
	if fields.Len() == 0 {
		t.Fatal("the envelope has no variants — DeclaredTopics would silently return nothing")
	}

	for i := range fields.Len() {
		variant := fields.Get(i).Message()

		topic, err := TopicOfDescriptor(variant)
		if err != nil {
			t.Errorf("%s: %v", variant.FullName(), err)

			continue
		}

		if topic == "" {
			t.Errorf("%s declares an empty topic", variant.FullName())
		}
	}
}

// The defaults are the point of the function: a caller that fills nothing in still gets the five
// attempts and the 60-second deadline, because those are the values whose absence fails silently.
func TestSubscriberOptionDefaults(t *testing.T) {
	opts := SubscriberOptions{ProjectID: "p"}.withDefaults()

	if opts.MaxDeliveryAttempts != 5 {
		t.Errorf("MaxDeliveryAttempts = %d, want Pub/Sub's floor of 5", opts.MaxDeliveryAttempts)
	}

	// For push this is the HTTP timeout too, and Pub/Sub's own default of 10s cancels a slower fold.
	if opts.PushAckDeadline != 60 {
		t.Errorf("PushAckDeadline = %d, want 60", opts.PushAckDeadline)
	}
}

// A subscription is built with every default in place. Each of these fails SILENTLY when absent, which
// is why they are asserted rather than left to review.
func TestDesiredSubscriptionCarriesTheSafeDefaults(t *testing.T) {
	sub := Subscription{ID: "liability-order-placed", Topic: "order-placed", Filter: `attributes.event_type = "x"`}
	want := desiredSubscription(sub, SubscriberOptions{ProjectID: "p"}.withDefaults())

	if want.GetDeadLetterPolicy().GetDeadLetterTopic() != "projects/p/topics/order-placed.dlq" {
		t.Errorf("dead letter topic = %q", want.GetDeadLetterPolicy().GetDeadLetterTopic())
	}

	// An ExpirationPolicy with no TTL means NEVER. Leaving the policy nil means the 31-day default —
	// the opposite, and indistinguishable at a glance.
	if want.GetExpirationPolicy() == nil || want.GetExpirationPolicy().GetTtl() != nil {
		t.Error("the subscription must never expire — an unset policy means deletion after 31 idle days")
	}

	// Fixed at creation. Off now, a later ordering key would mean recreating every subscription.
	if !want.GetEnableMessageOrdering() {
		t.Error("enable_message_ordering must be on — it cannot be turned on later")
	}

	// Unset, Pub/Sub redelivers "as soon as possible": a 30-second outage burns all five attempts.
	if want.GetRetryPolicy().GetMinimumBackoff().AsDuration() != retryMinBackoff {
		t.Errorf("minimum backoff = %v, want %v", want.GetRetryPolicy().GetMinimumBackoff().AsDuration(), retryMinBackoff)
	}

	// No PushBaseURL means a PULL subscription, and a push_config would quietly make it a push one.
	if want.GetPushConfig().GetPushEndpoint() != "" {
		t.Errorf("push endpoint = %q, want none when PushBaseURL is empty", want.GetPushConfig().GetPushEndpoint())
	}
}

func TestDesiredSubscriptionBuildsThePushEndpoint(t *testing.T) {
	sub := Subscription{ID: "liability-order-placed", Topic: "order-placed"}

	// The trailing slash is trimmed, so a base URL written either way produces one endpoint.
	want := desiredSubscription(sub, SubscriberOptions{
		ProjectID:   "p",
		PushBaseURL: "https://api.example.com/",
	}.withDefaults())

	got := want.GetPushConfig().GetPushEndpoint()
	if got != "https://api.example.com/event/liability-order-placed/push" {
		t.Errorf("push endpoint = %q", got)
	}
}

// Pub/Sub cannot change these three, and this tool never deletes a subscription to work around that —
// deleting one discards everything undelivered on it. The error must name the FIELD, or the reader is
// left to work out which of three moved.
func TestRefuseImmutableChangesNamesTheField(t *testing.T) {
	sub := Subscription{ID: "liability-order-placed", Topic: "order-placed", Filter: `attributes.event_type = "new"`}
	opts := SubscriberOptions{ProjectID: "p"}.withDefaults()

	want := desiredSubscription(sub, opts)

	existing := desiredSubscription(
		Subscription{ID: sub.ID, Topic: sub.Topic, Filter: `attributes.event_type = "old"`}, opts)

	err := refuseImmutableChanges(sub, existing, want)
	if err == nil {
		t.Fatal("a changed filter must be refused — Pub/Sub cannot update it")
	}

	if !strings.Contains(err.Error(), "filter") || !strings.Contains(err.Error(), sub.ID) {
		t.Errorf("the error must name the subscription and the field, got: %v", err)
	}
}

func TestRefuseImmutableChangesAllowsAnUnchangedSubscription(t *testing.T) {
	sub := Subscription{ID: "liability-order-placed", Topic: "order-placed", Filter: "f"}
	opts := SubscriberOptions{ProjectID: "p"}.withDefaults()

	want := desiredSubscription(sub, opts)

	err := refuseImmutableChanges(sub, desiredSubscription(sub, opts), want)
	if err != nil {
		t.Errorf("nothing changed, so nothing should be refused: %v", err)
	}
}
