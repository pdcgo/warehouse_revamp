package main

import (
	"context"
	"fmt"

	"cloud.google.com/go/pubsub/v2"
	"github.com/urfave/cli/v3"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
)

// The Pub/Sub provisioning commands.
//
// These are a DEVELOPER'S TOOL (setup-functions-are-a-developer-tool). No service checks its topics or
// subscriptions at startup (services-do-not-verify-setup-at-boot), so nothing exists until somebody
// runs this — which is the trade: a service needs no admin permissions in production, and a route
// whose subscription nobody created receives nothing and says nothing.
//
// It lives in `san` rather than in the server for the same reason `migrate` does: it acts on real
// infrastructure, at a moment a person chooses (HARD RULE 3b).
//
//	go run ./tools/san pubsub ensure --project warehouse-dev --emulator
//	go run ./tools/san pubsub redrive --project warehouse-dev --topic order-placed --emulator
func pubsubCommand() *cli.Command {
	return &cli.Command{
		Name:  "pubsub",
		Usage: "create and update the event topics and subscriptions",
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:     "project",
				Usage:    "the GCP project id (or any stable id, against the emulator)",
				Required: true,
			},
			&cli.BoolFlag{
				Name:  "emulator",
				Usage: "talk to the local emulator (PUBSUB_EMULATOR_HOST, default localhost:8085)",
			},
		},
		Commands: []*cli.Command{
			pubsubEnsureCommand(),
			pubsubRedriveCommand(),
		},
	}
}

// pubsubEnsureCommand is the one-command path for a fresh broker.
//
// It ENSURES rather than creates: run it as often as you like. What is missing is created with every
// safe default built in, what may change is updated, and what Pub/Sub cannot change is REFUSED by name
// — never deleted (setup-ensures-safe-defaults-never-deletes).
func pubsubEnsureCommand() *cli.Command {
	return &cli.Command{
		Name:  "ensure",
		Usage: "make every declared topic and subscription exist, with the safe defaults",
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name: "push-base-url",
				Usage: "base URL for PUSH subscriptions, e.g. https://api.example.com. " +
					"Omit for pull subscriptions",
			},
			&cli.IntFlag{
				Name: "project-number",
				Usage: "the numeric project id, which names the Pub/Sub service agent the dead-letter " +
					"grants go to. Omit against the emulator, which has no IAM",
			},
			&cli.BoolFlag{
				Name:  "topics-only",
				Usage: "create the topics, their DLQs and the triage subscriptions, and stop there",
			},
		},
		Action: func(ctx context.Context, cmd *cli.Command) error {
			project := cmd.String("project")

			client, err := pubsubClient(ctx, cmd, project)
			if err != nil {
				return err
			}

			defer func() { _ = client.Close() }()

			topics, err := event_source.DeclaredTopics()
			if err != nil {
				return err
			}

			fmt.Printf("project %s — %d topics declared by the proto:\n", project, len(topics))

			for _, topic := range topics {
				fmt.Printf("  %s  (+ %s.dlq, %s.dlq.triage)\n", topic, topic, topic)
			}

			err = event_source.InitializeTopic(ctx, client, event_source.TopicOptions{ProjectID: project})
			if err != nil {
				return err
			}

			fmt.Println("topics ensured")

			if cmd.Bool("topics-only") {
				return nil
			}

			subs := declaredSubscriptions()

			err = event_source.InitializeSubscriber(ctx, client, subs, event_source.SubscriberOptions{
				ProjectID:     project,
				PushBaseURL:   cmd.String("push-base-url"),
				ProjectNumber: int64(cmd.Int("project-number")),
			})
			if err != nil {
				return err
			}

			for _, sub := range subs {
				fmt.Printf("  %s on %s\n", sub.ID, sub.Topic)
			}

			fmt.Println("subscriptions ensured")

			// Reported, never deleted. One is usually a consumer somebody else owns, or a rename
			// mid-flight — and deleting it would discard everything undelivered on it, silently.
			extra, err := event_source.UndeclaredSubscriptions(ctx, client, subs, project)
			if err != nil {
				return err
			}

			for _, name := range extra {
				fmt.Printf("⚠ not declared here, left alone: %s\n", name)
			}

			return nil
		},
	}
}

// pubsubRedriveCommand brings dead-lettered events back.
//
// ⚠ RUN IT ONCE THE CAUSE IS FIXED, never on a schedule: a message that still fails would loop back
// into the DLQ and out again forever. It is safe to run twice — every consumer claims on event_id, so
// anything that did get through is a duplicate the second time.
func pubsubRedriveCommand() *cli.Command {
	return &cli.Command{
		Name:  "redrive",
		Usage: "re-publish every message sitting in <topic>.dlq back to <topic>",
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:     "topic",
				Usage:    "the SOURCE topic, not the .dlq",
				Required: true,
			},
		},
		Action: func(ctx context.Context, cmd *cli.Command) error {
			project := cmd.String("project")
			topic := cmd.String("topic")

			client, err := pubsubClient(ctx, cmd, project)
			if err != nil {
				return err
			}

			defer func() { _ = client.Close() }()

			fmt.Printf("redriving %s.dlq → %s (stops after 15s of quiet)\n", topic, topic)

			err = event_source.Redrive(ctx, client, topic)
			if err != nil {
				return err
			}

			fmt.Println("redrive finished")

			return nil
		},
	}
}

// declaredSubscriptions is every subscription this repo's services declare.
//
// Listed here rather than discovered, because a service's subscriptions are a DEPLOYMENT decision, not
// a property of its code: the same handler is a push route in one environment and a pull worker in
// another. Each entry mirrors the constants the owning service declares beside its handler.
//
// ⚠ EVERY ONE CARRIES A FILTER on event_type, and that is load-bearing rather than tidy. The envelope's
// oneof is required (the-event-oneof-is-required), so a variant a consumer has not regenerated arrives
// as a RECORDED REJECTION — noise on every message of a new kind. The filter stops it arriving at all,
// and a subscription's filter is IMMUTABLE, so it has to be right the first time.
func declaredSubscriptions() []event_source.Subscription {
	return []event_source.Subscription{
		{
			ID:     "liability-order-placed",
			Topic:  "order-placed",
			Filter: `attributes.event_type = "warehouse.events.v1.OrderPlaced"`,
		},
		{
			ID:     "liability-order-cancelled",
			Topic:  "order-cancelled",
			Filter: `attributes.event_type = "warehouse.events.v1.OrderCancelled"`,
		},
	}
}

// pubsubClient connects to the emulator or to real Pub/Sub.
//
// Against a real project the client uses application default credentials, exactly as the server does —
// there is no separate admin credential to configure, and no service account file to leave lying
// around a laptop.
func pubsubClient(ctx context.Context, cmd *cli.Command, project string) (*pubsub.Client, error) {
	if cmd.Bool("emulator") {
		return event_source.NewPubsubEmulator(ctx, project)
	}

	return pubsub.NewClient(ctx, project)
}
