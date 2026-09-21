package event_source

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	iampb "cloud.google.com/go/iam/apiv1/iampb"
	"cloud.google.com/go/pubsub/v2"
	"cloud.google.com/go/pubsub/v2/apiv1/pubsubpb"
	"google.golang.org/api/iterator"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
)

// These functions are a DEVELOPER'S TOOL, not boot code (setup-functions-are-a-developer-tool). No
// service verifies its setup at startup (services-do-not-verify-setup-at-boot), so nothing here runs
// unless a person runs it.
//
// They ENSURE (setup-ensures-safe-defaults-never-deletes): create what is missing with the safe
// defaults built in, update what may change, and REFUSE — never delete — what Pub/Sub cannot change.
// A subscription that exists but is not declared is left alone and reported.
//
// ⚠ THE PROJECT ID IS PASSED IN. The Pub/Sub client keeps its project unexported with no accessor, and
// every admin call needs a full resource name, so the options carry it rather than the functions
// guessing.
const (
	// topicRetention is what makes a replay possible at all, and what bounds it: Pub/Sub's maximum,
	// and the reach every replay decision in this system already assumes
	// (no-archive-events-live-31-days — there is no archive behind it).
	topicRetention = 31 * 24 * time.Hour

	// retryMinBackoff / retryMaxBackoff. UNSET, Pub/Sub redelivers "as soon as possible", so a
	// 30-second outage burns all five delivery attempts and dead-letters perfectly good events.
	retryMinBackoff = 10 * time.Second
	retryMaxBackoff = 600 * time.Second

	// dlqSuffix and triageSuffix. A DLQ with no subscription is a hole: "messages published to a topic
	// with no subscriptions are lost", so the triage subscription is created with the DLQ, never later.
	dlqSuffix    = ".dlq"
	triageSuffix = ".dlq.triage"
)

// TopicOptions configures InitializeTopic.
type TopicOptions struct {
	ProjectID string
}

// Subscription is one consumer's declaration — the same value the adopter checklist says a service
// declares once, and the route, the provisioning and the pull worker all read.
type Subscription struct {
	// ID is the short id, "settlement-fold". The push route is /event/<ID>/push.
	ID string

	// Topic must be a topic some variant declares. It is CHECKED against the proto, never trusted: a
	// typo would otherwise create a subscription on a topic nothing ever publishes to, which is
	// silence that looks like health.
	Topic string

	// Filter is a Pub/Sub filter over the message ATTRIBUTES, normally on event_type.
	//
	// ⚠ IMMUTABLE once the subscription exists, and it matters more than it looks: with the oneof
	// required (the-event-oneof-is-required), a variant this consumer has not regenerated arrives as
	// a recorded rejection rather than silence. A filter is what stops it arriving at all — and it
	// cannot be added later, so it has to be right now.
	Filter string
}

// SubscriberOptions configures InitializeSubscriber.
type SubscriberOptions struct {
	ProjectID string

	// PushBaseURL empty means a PULL subscription. Otherwise the endpoint is
	// <PushBaseURL>/event/<ID>/push.
	PushBaseURL string

	// ProjectNumber names the Pub/Sub service agent the dead-letter grants go to.
	//
	// ⚠ ZERO SKIPS THE GRANTS, which is what dev wants: the emulator implements no IAM. Against a real
	// project, leaving it zero means nothing ever dead-letters and no error says so.
	ProjectNumber int64

	// MaxDeliveryAttempts before a message goes to the DLQ. Pub/Sub's floor and default is 5.
	MaxDeliveryAttempts int32

	// PushAckDeadline in seconds. ⚠ For PUSH this is also the HTTP request timeout, and Pub/Sub's
	// default is 10 — a slower fold is cancelled, rolls back, and dead-letters after five tries. Pull
	// is unaffected: its client extends the deadline on its own.
	PushAckDeadline int32
}

func (o SubscriberOptions) withDefaults() SubscriberOptions {
	if o.MaxDeliveryAttempts == 0 {
		o.MaxDeliveryAttempts = 5
	}

	if o.PushAckDeadline == 0 {
		o.PushAckDeadline = 60
	}

	return o
}

// DeclaredTopics is every topic the PROTO declares — one per variant of the Event envelope, read from
// the descriptor.
//
// Walked rather than listed so no caller passes a set it could get wrong. A variant added next month
// is provisioned by re-running the tool, with nothing to remember to update.
func DeclaredTopics() ([]string, error) {
	oneof := (&eventsv1.Event{}).ProtoReflect().Descriptor().Oneofs().ByName("message")
	if oneof == nil {
		return nil, errors.New("event_source: the Event envelope has no message oneof")
	}

	seen := map[string]bool{}

	fields := oneof.Fields()
	for i := range fields.Len() {
		variant := fields.Get(i).Message()

		topic, err := TopicOfDescriptor(variant)
		if err != nil {
			return nil, err
		}

		seen[topic] = true
	}

	topics := make([]string, 0, len(seen))
	for topic := range seen {
		topics = append(topics, topic)
	}

	// Sorted so a run's output, and any diff of it, is stable.
	sort.Strings(topics)

	return topics, nil
}

// InitializeTopic makes every topic the proto declares exist, each with 31-day retention, a <topic>.dlq
// and a <topic>.dlq.triage subscription that never expires.
func InitializeTopic(ctx context.Context, client *pubsub.Client, opts TopicOptions) error {
	if opts.ProjectID == "" {
		return errors.New("event_source: InitializeTopic needs a ProjectID")
	}

	topics, err := DeclaredTopics()
	if err != nil {
		return err
	}

	for _, topic := range topics {
		err = ensureTopic(ctx, client, opts.ProjectID, topic)
		if err != nil {
			return err
		}

		dlq := topic + dlqSuffix

		err = ensureTopic(ctx, client, opts.ProjectID, dlq)
		if err != nil {
			return err
		}

		err = ensureTriage(ctx, client, opts.ProjectID, topic, dlq)
		if err != nil {
			return err
		}
	}

	return nil
}

// InitializeSubscriber makes ONE service's declared subscriptions exist, with the safe defaults built
// in.
//
// It never creates a topic. A subscription whose topic is missing is an error — run InitializeTopic
// first — because creating one here would hide a typo behind a topic nothing publishes to.
func InitializeSubscriber(
	ctx context.Context,
	client *pubsub.Client,
	subs []Subscription,
	opts SubscriberOptions,
) error {
	if opts.ProjectID == "" {
		return errors.New("event_source: InitializeSubscriber needs a ProjectID")
	}

	opts = opts.withDefaults()

	declared, err := DeclaredTopics()
	if err != nil {
		return err
	}

	known := map[string]bool{}
	for _, topic := range declared {
		known[topic] = true
	}

	for _, sub := range subs {
		if !known[sub.Topic] {
			return fmt.Errorf(
				"event_source: subscription %q names topic %q, which no event variant declares — a typo here is silence that looks like health",
				sub.ID, sub.Topic,
			)
		}

		err = ensureSubscription(ctx, client, sub, opts)
		if err != nil {
			return err
		}
	}

	return nil
}

// Redrive pulls every message from <topic>.dlq.triage, re-publishes it to <topic> unchanged, and acks
// it.
//
// Safe to run twice: every consumer claims on event_id, so a message that made it through the first
// time is a duplicate the second. Run by a PERSON once the cause is fixed — never on a schedule, which
// would loop a message that still fails.
func Redrive(ctx context.Context, client *pubsub.Client, topic string) error {
	triage := client.Subscriber(topic + triageSuffix)
	publisher := client.Publisher(topic)

	defer publisher.Stop()

	// Redrive returns when the triage subscription goes quiet, not when it is provably empty — there
	// is no "is it empty" in Pub/Sub. A short idle window is what stands in for one.
	drainCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	idle := time.AfterFunc(15*time.Second, cancel)

	var failure error

	err := triage.Receive(drainCtx, func(msgCtx context.Context, msg *pubsub.Message) {
		idle.Reset(15 * time.Second)

		result := publisher.Publish(msgCtx, &pubsub.Message{
			Data:        msg.Data,
			Attributes:  msg.Attributes,
			OrderingKey: msg.OrderingKey,
		})

		_, publishErr := result.Get(msgCtx)
		if publishErr != nil {
			// NACK: the message stays in triage rather than being lost on the way back.
			msg.Nack()

			failure = publishErr

			cancel()

			return
		}

		msg.Ack()
	})
	if err != nil && !errors.Is(err, context.Canceled) {
		return fmt.Errorf("event_source: redriving %s: %w", topic, err)
	}

	return failure
}

func topicPath(project, topic string) string {
	return fmt.Sprintf("projects/%s/topics/%s", project, topic)
}

func subscriptionPath(project, sub string) string {
	return fmt.Sprintf("projects/%s/subscriptions/%s", project, sub)
}

func isNotFound(err error) bool {
	return status.Code(err) == codes.NotFound
}

// ensureTopic creates the topic with 31-day retention, or updates the retention if it differs.
func ensureTopic(ctx context.Context, client *pubsub.Client, project, topic string) error {
	name := topicPath(project, topic)
	want := durationpb.New(topicRetention)

	existing, err := client.TopicAdminClient.GetTopic(ctx, &pubsubpb.GetTopicRequest{Topic: name})
	if err != nil {
		if !isNotFound(err) {
			return fmt.Errorf("event_source: reading topic %s: %w", topic, err)
		}

		_, err = client.TopicAdminClient.CreateTopic(ctx, &pubsubpb.Topic{
			Name:                     name,
			MessageRetentionDuration: want,
		})
		if err != nil {
			return fmt.Errorf("event_source: creating topic %s: %w", topic, err)
		}

		return nil
	}

	if existing.GetMessageRetentionDuration().AsDuration() == topicRetention {
		return nil
	}

	_, err = client.TopicAdminClient.UpdateTopic(ctx, &pubsubpb.UpdateTopicRequest{
		Topic:      &pubsubpb.Topic{Name: name, MessageRetentionDuration: want},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"message_retention_duration"}},
	})
	if err != nil {
		return fmt.Errorf("event_source: updating retention on %s: %w", topic, err)
	}

	return nil
}

// ensureTriage creates the DLQ's own subscription, which never expires.
//
// Without it the DLQ is a hole rather than a queue: a topic with no subscriptions drops what is
// published to it, so a dead-lettered event would be lost exactly when it matters most. It never
// expires because it is quiet precisely when things are healthy — a 31-day idle deletion would remove
// it during the good months and leave nothing there for the bad week.
func ensureTriage(ctx context.Context, client *pubsub.Client, project, topic, dlq string) error {
	name := subscriptionPath(project, topic+triageSuffix)

	_, err := client.SubscriptionAdminClient.GetSubscription(ctx, &pubsubpb.GetSubscriptionRequest{
		Subscription: name,
	})
	if err == nil {
		return nil
	}

	if !isNotFound(err) {
		return fmt.Errorf("event_source: reading triage subscription for %s: %w", topic, err)
	}

	_, err = client.SubscriptionAdminClient.CreateSubscription(ctx, &pubsubpb.Subscription{
		Name:  name,
		Topic: topicPath(project, dlq),
		// An ExpirationPolicy with no TTL means NEVER EXPIRES. Leaving the policy unset is the
		// opposite — it means the 31-day default.
		ExpirationPolicy: &pubsubpb.ExpirationPolicy{},
	})
	if err != nil {
		return fmt.Errorf("event_source: creating triage subscription for %s: %w", topic, err)
	}

	return nil
}

// ensureSubscription creates a subscription with every default, or updates what Pub/Sub allows to
// change and REFUSES what it does not.
func ensureSubscription(
	ctx context.Context,
	client *pubsub.Client,
	sub Subscription,
	opts SubscriberOptions,
) error {
	want := desiredSubscription(sub, opts)

	existing, err := client.SubscriptionAdminClient.GetSubscription(ctx, &pubsubpb.GetSubscriptionRequest{
		Subscription: want.GetName(),
	})
	if err != nil {
		if !isNotFound(err) {
			return fmt.Errorf("event_source: reading subscription %s: %w", sub.ID, err)
		}

		_, err = client.SubscriptionAdminClient.CreateSubscription(ctx, want)
		if err != nil {
			return fmt.Errorf("event_source: creating subscription %s: %w", sub.ID, err)
		}

		return grantDeadLetterAccess(ctx, client, sub, opts)
	}

	// The three Pub/Sub cannot change. Refused rather than worked around: recreating would delete a
	// subscription, and everything undelivered on it, to fix a config line. The repair is a NEW id —
	// declare settlement-fold-v2 and run the tool again.
	err = refuseImmutableChanges(sub, existing, want)
	if err != nil {
		return err
	}

	_, err = client.SubscriptionAdminClient.UpdateSubscription(ctx, &pubsubpb.UpdateSubscriptionRequest{
		Subscription: want,
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{
			"ack_deadline_seconds",
			"dead_letter_policy",
			"expiration_policy",
			"push_config",
			"retry_policy",
		}},
	})
	if err != nil {
		return fmt.Errorf("event_source: updating subscription %s: %w", sub.ID, err)
	}

	return grantDeadLetterAccess(ctx, client, sub, opts)
}

func desiredSubscription(sub Subscription, opts SubscriberOptions) *pubsubpb.Subscription {
	want := &pubsubpb.Subscription{
		Name:               subscriptionPath(opts.ProjectID, sub.ID),
		Topic:              topicPath(opts.ProjectID, sub.Topic),
		Filter:             sub.Filter,
		AckDeadlineSeconds: opts.PushAckDeadline,

		// Never expires. Unset would mean deletion after 31 idle days, which is quiet exactly when
		// things are healthy.
		ExpirationPolicy: &pubsubpb.ExpirationPolicy{},

		// Fixed at creation, so it is turned on now even though no key is set
		// (ordering-is-each-services-job). Off, adding a key later would mean recreating every
		// subscription — and recreating one loses whatever is undelivered on it.
		EnableMessageOrdering: true,

		DeadLetterPolicy: &pubsubpb.DeadLetterPolicy{
			DeadLetterTopic:     topicPath(opts.ProjectID, sub.Topic+dlqSuffix),
			MaxDeliveryAttempts: opts.MaxDeliveryAttempts,
		},

		RetryPolicy: &pubsubpb.RetryPolicy{
			MinimumBackoff: durationpb.New(retryMinBackoff),
			MaximumBackoff: durationpb.New(retryMaxBackoff),
		},
	}

	if opts.PushBaseURL != "" {
		want.PushConfig = &pubsubpb.PushConfig{
			PushEndpoint: strings.TrimSuffix(opts.PushBaseURL, "/") + "/event/" + sub.ID + "/push",
		}
	}

	return want
}

// refuseImmutableChanges names the subscription AND the field. A message saying only "cannot update"
// leaves the reader to work out which of three settings moved.
func refuseImmutableChanges(sub Subscription, existing, want *pubsubpb.Subscription) error {
	if existing.GetTopic() != want.GetTopic() {
		return immutableError(sub.ID, "topic", existing.GetTopic(), want.GetTopic())
	}

	if existing.GetFilter() != want.GetFilter() {
		return immutableError(sub.ID, "filter", existing.GetFilter(), want.GetFilter())
	}

	if existing.GetEnableMessageOrdering() != want.GetEnableMessageOrdering() {
		return immutableError(sub.ID, "enable_message_ordering",
			fmt.Sprint(existing.GetEnableMessageOrdering()), fmt.Sprint(want.GetEnableMessageOrdering()))
	}

	return nil
}

func immutableError(id, field, have, want string) error {
	return fmt.Errorf(
		"event_source: subscription %q has %s = %q and the declaration says %q — Pub/Sub cannot change it, "+
			"and this tool never deletes a subscription to work around that. Declare a NEW id and retire the old one once it is drained",
		id, field, have, want,
	)
}

// grantDeadLetterAccess gives the Pub/Sub service agent the two permissions dead-lettering needs.
//
// ⚠ WITHOUT BOTH, NOTHING DEAD-LETTERS AND NO ERROR SAYS SO. The policy is set, the delivery attempts
// climb, and the message redelivers forever — the failure mode the DLQ existed to prevent, now
// invisible.
//
// Skipped when ProjectNumber is 0, which is what dev wants: the emulator implements no IAM.
func grantDeadLetterAccess(
	ctx context.Context,
	client *pubsub.Client,
	sub Subscription,
	opts SubscriberOptions,
) error {
	if opts.ProjectNumber == 0 {
		return nil
	}

	agent := fmt.Sprintf("serviceAccount:service-%d@gcp-sa-pubsub.iam.gserviceaccount.com", opts.ProjectNumber)

	// Publisher on the DLQ: without it the forwarded message is refused.
	dlq := topicPath(opts.ProjectID, sub.Topic+dlqSuffix)

	err := addTopicBinding(ctx, client, dlq, "roles/pubsub.publisher", agent)
	if err != nil {
		return err
	}

	// Subscriber on the source subscription: without it the agent cannot ack what it forwarded, so the
	// message comes back.
	return addSubscriptionBinding(ctx, client,
		subscriptionPath(opts.ProjectID, sub.ID), "roles/pubsub.subscriber", agent)
}

func addTopicBinding(ctx context.Context, client *pubsub.Client, resource, role, member string) error {
	policy, err := client.TopicAdminClient.GetIamPolicy(ctx, &iampb.GetIamPolicyRequest{Resource: resource})
	if err != nil {
		return fmt.Errorf("event_source: reading the IAM policy of %s: %w", resource, err)
	}

	if !addBinding(policy, role, member) {
		return nil
	}

	_, err = client.TopicAdminClient.SetIamPolicy(ctx, &iampb.SetIamPolicyRequest{
		Resource: resource,
		Policy:   policy,
	})
	if err != nil {
		return fmt.Errorf("event_source: granting %s on %s: %w", role, resource, err)
	}

	return nil
}

func addSubscriptionBinding(ctx context.Context, client *pubsub.Client, resource, role, member string) error {
	policy, err := client.SubscriptionAdminClient.GetIamPolicy(ctx, &iampb.GetIamPolicyRequest{Resource: resource})
	if err != nil {
		return fmt.Errorf("event_source: reading the IAM policy of %s: %w", resource, err)
	}

	if !addBinding(policy, role, member) {
		return nil
	}

	_, err = client.SubscriptionAdminClient.SetIamPolicy(ctx, &iampb.SetIamPolicyRequest{
		Resource: resource,
		Policy:   policy,
	})
	if err != nil {
		return fmt.Errorf("event_source: granting %s on %s: %w", role, resource, err)
	}

	return nil
}

// addBinding adds member to role and reports whether anything changed, so an unchanged policy is never
// written back — a SetIamPolicy that changes nothing still races with whatever else is editing it.
func addBinding(policy *iampb.Policy, role, member string) bool {
	for _, binding := range policy.GetBindings() {
		if binding.GetRole() != role {
			continue
		}

		for _, existing := range binding.GetMembers() {
			if existing == member {
				return false
			}
		}

		binding.Members = append(binding.Members, member)

		return true
	}

	policy.Bindings = append(policy.Bindings, &iampb.Binding{Role: role, Members: []string{member}})

	return true
}

// UndeclaredSubscriptions lists subscriptions on the declared topics that no declaration names.
//
// Reported, NEVER deleted. One is usually a consumer somebody else owns, or a rename mid-flight — and
// deleting it would discard every message undelivered on it, silently.
func UndeclaredSubscriptions(
	ctx context.Context,
	client *pubsub.Client,
	subs []Subscription,
	projectID string,
) ([]string, error) {
	declared := map[string]bool{}
	for _, sub := range subs {
		declared[subscriptionPath(projectID, sub.ID)] = true
	}

	topics, err := DeclaredTopics()
	if err != nil {
		return nil, err
	}

	found := []string{}

	for _, topic := range topics {
		it := client.TopicAdminClient.ListTopicSubscriptions(ctx, &pubsubpb.ListTopicSubscriptionsRequest{
			Topic: topicPath(projectID, topic),
		})

		for {
			name, iterErr := it.Next()
			if errors.Is(iterErr, iterator.Done) {
				break
			}

			if iterErr != nil {
				return nil, fmt.Errorf("event_source: listing subscriptions on %s: %w", topic, iterErr)
			}

			if !declared[name] {
				found = append(found, name)
			}
		}
	}

	sort.Strings(found)

	return found, nil
}
