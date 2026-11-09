package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/pubsub/v2"
	"github.com/urfave/cli/v3"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A STUCK RELEASE, REPLAYED BY SAN (a-stuck-release-is-replayed-by-san).
//
// Inventory gives an order's stock back from two events: InventoryTxCancel (a create that failed after its take) and
// OrderCancelled (a cancelled order). A release that keeps failing — a stock count holding the rack past the retry limit,
// a database outage longer than the backoff — is dead-lettered into `<topic>.dlq`, and the stock stays taken. These
// commands read the dead-letter's triage subscription and give it back:
//
//	go run ./tools/san pubsub --project warehouse-dev --emulator releases list
//	go run ./tools/san pubsub --project warehouse-dev --emulator releases replay --dry-run
//	go run ./tools/san pubsub --project warehouse-dev --emulator releases replay
//
// The replay calls INVENTORY'S OWN LISTENER in-process (HARD RULE 3b: a command calls the handler, never a hand-written
// UPDATE) — the very push handler behind /event/inventory-*/push, so a replay is judged exactly as the delivery that
// failed. It is SAFE TO RUN TWICE: the release goes by the key, and a key is released once (a-used-key-is-never-
// cancelled) — a second replay of the same event finds it released and does nothing. A message is ACKED (removed from
// the dead-letter) only when the release answered nil; a failure is left where it was, and said.
//
// It is NOT `pubsub redrive`: a redrive republishes to the SOURCE topic, which redelivers an OrderCancelled to every
// subscriber of order-cancelled (settlement, liability) as well. This command only ever releases stock, and it leaves a
// dead-letter another consumer owns — Pub/Sub names it in CloudPubSubDeadLetterSourceSubscription — for that consumer's
// own redrive.

// releaseTopics are the two topics whose dead-letters hold a stuck release, each with inventory's subscription on it —
// the mirrors of inventory_service.InventoryTxCancelSubscription and InventoryOrderCancelledSubscription.
var releaseTopics = []struct{ topic, subscription string }{
	{topic: "inventory-tx-cancel", subscription: inventory_service.InventoryTxCancelSubscription},
	{topic: "order-cancelled", subscription: inventory_service.InventoryOrderCancelledSubscription},
}

// The attributes Pub/Sub stamps on a dead-lettered message: the subscription it failed on — its short id — and that
// subscription's project. (Read off the emulator's own dead-letters: `inventory-tx-cancel`, `warehouse-dev`.)
const (
	deadLetterSourceAttribute              = "CloudPubSubDeadLetterSourceSubscription"
	deadLetterSourceProjectAttribute       = "CloudPubSubDeadLetterSourceSubscriptionProject"
	deadLetterSourceDeliveryCountAttribute = "CloudPubSubDeadLetterSourceDeliveryCount"
)

// fromOwnSubscription reports whether a dead-letter is inventory's own: its source names inventory's subscription (by
// short id, or as a full path) in this project. A message with no source named was put there by hand — taken as a
// release, since only a person writes to a dead-letter directly.
func fromOwnSubscription(attrs map[string]string, project, subscription string) (bool, string) {
	source := attrs[deadLetterSourceAttribute]
	if source == "" {
		return true, ""
	}

	short := source[strings.LastIndex(source, "/")+1:]

	if sourceProject := attrs[deadLetterSourceProjectAttribute]; sourceProject != "" && sourceProject != project {
		return false, sourceProject + "/" + short
	}

	return short == subscription, short
}

// deadLetter is one message read off a dead-letter's triage subscription.
type deadLetter struct {
	ID         string
	Data       []byte
	Attributes map[string]string
	Attempts   int
}

// deadLetterQueue reads a topic's dead-letter. Drain hands every message waiting in `<topic>.dlq.triage` to fn ONCE and
// returns when no new message has arrived for a quiet window; fn answers true to ACK (remove) the message, false to
// leave it where it is.
type deadLetterQueue interface {
	Drain(ctx context.Context, topic string, fn func(deadLetter) bool) error
}

// pubsubDeadLetters is deadLetterQueue on Pub/Sub (or the emulator).
type pubsubDeadLetters struct {
	client *pubsub.Client
	quiet  time.Duration
}

func (q pubsubDeadLetters) Drain(ctx context.Context, topic string, fn func(deadLetter) bool) error {
	triage := q.client.Subscriber(topic + ".dlq.triage")

	drainCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	// A left message is NACKED and redelivered at once, so "quiet" means no NEW message — a message seen before is
	// left again and does not hold the window open (there is no "is it empty" in Pub/Sub).
	idle := time.AfterFunc(q.quiet, cancel)
	defer idle.Stop()

	var (
		mu   sync.Mutex
		seen = map[string]bool{}
	)

	err := triage.Receive(drainCtx, func(_ context.Context, msg *pubsub.Message) {
		mu.Lock()
		defer mu.Unlock()

		if seen[msg.ID] {
			msg.Nack()

			return
		}

		seen[msg.ID] = true
		idle.Reset(q.quiet)

		// How often the SOURCE subscription tried it — Pub/Sub's stamp on the dead-letter. The triage subscription has
		// no dead-letter policy of its own, so its DeliveryAttempt is never set.
		attempts, _ := strconv.Atoi(msg.Attributes[deadLetterSourceDeliveryCountAttribute])

		ack := fn(deadLetter{ID: msg.ID, Data: msg.Data, Attributes: msg.Attributes, Attempts: attempts})

		// The window starts again AFTER the work: a slow release must not count as quiet.
		idle.Reset(q.quiet)

		if ack {
			msg.Ack()

			return
		}

		msg.Nack()
	})
	if err != nil && !errors.Is(err, context.Canceled) {
		return fmt.Errorf("reading %s.dlq.triage: %w", topic, err)
	}

	return nil
}

// releaseMode is what `releases` does with each stuck release it finds.
type releaseMode int

const (
	releasesList   releaseMode = iota // print it, touch nothing
	releasesDryRun                    // print what a replay would release, touch nothing
	releasesReplay                    // release it through inventory's listener, ACK it on success
)

// releaseSummary is the run's count, printed last and returned for the test.
type releaseSummary struct {
	Found, Released, Failed, Left int
}

// stuckReleases is `san pubsub releases`, free of the CLI and of Pub/Sub so a test can drive it.
type stuckReleases struct {
	out     io.Writer
	queue   deadLetterQueue
	project string
	mode    releaseMode
	// release is inventory's push handler (NewInventoryPushHandler) — nil in list and dry-run, which never release.
	release event_source.PushHandler
}

func (r stuckReleases) run(ctx context.Context) (releaseSummary, error) {
	var sum releaseSummary

	for _, rt := range releaseTopics {
		fmt.Fprintf(r.out, "%s.dlq (inventory's %s):\n", rt.topic, rt.subscription)

		found := 0

		err := r.queue.Drain(ctx, rt.topic, func(m deadLetter) bool {
			found++

			// Another consumer's dead-letter on the same topic (settlement's or liability's OrderCancelled) is THEIRS to
			// redrive: left where it is, never acked here. One with no source named is a release put there by hand.
			if own, source := fromOwnSubscription(m.Attributes, r.project, rt.subscription); !own {
				fmt.Fprintf(r.out, "  %s  dead-lettered by %s — not a release, left for that consumer's redrive\n",
					m.ID, source)
				sum.Left++

				return false
			}

			event, err := event_source.DecodeEvent(m.Data)
			if err != nil {
				fmt.Fprintf(r.out, "  %s  cannot be decoded (%v) — left\n", m.ID, err)
				sum.Left++

				return false
			}

			line, ok := describeRelease(event)
			if !ok {
				fmt.Fprintf(r.out, "  %s  event %s is not a release — left\n", m.ID, event.GetEventId())
				sum.Left++

				return false
			}

			sum.Found++

			switch r.mode {
			case releasesList:
				fmt.Fprintf(r.out, "  %s  %s · %d attempts\n", m.ID, line, m.Attempts)

				return false
			case releasesDryRun:
				fmt.Fprintf(r.out, "  %s  %s · would replay\n", m.ID, line)

				return false
			}

			err = r.release(ctx, event)
			if err != nil {
				fmt.Fprintf(r.out, "  %s  %s · STILL FAILS, left in the dead-letter: %v\n", m.ID, line, err)
				sum.Failed++

				return false
			}

			fmt.Fprintf(r.out, "  %s  %s · replayed, removed from the dead-letter\n", m.ID, line)
			sum.Released++

			return true
		})
		if err != nil {
			return sum, err
		}

		if found == 0 {
			fmt.Fprintln(r.out, "  (empty)")
		}
	}

	switch r.mode {
	case releasesReplay:
		fmt.Fprintf(r.out, "%d stuck releases: %d replayed, %d still failing; %d other messages left\n",
			sum.Found, sum.Released, sum.Failed, sum.Left)
	default:
		fmt.Fprintf(r.out, "%d stuck releases, nothing replayed; %d other messages left\n", sum.Found, sum.Left)
	}

	return sum, nil
}

// describeRelease names a release event for a person: which key, whose, where — or false for any other variant.
func describeRelease(event *eventsv1.Event) (string, bool) {
	switch v := event.GetMessage().(type) {
	case *eventsv1.Event_InventoryTxCancel:
		c := v.InventoryTxCancel

		return fmt.Sprintf("InventoryTxCancel key=%s team=%d warehouse=%d (%s)",
			c.GetIdempotencyKey(), c.GetTeamId(), c.GetWarehouseId(), event.GetEventId()), true
	case *eventsv1.Event_OrderCancelled:
		c := v.OrderCancelled

		return fmt.Sprintf("OrderCancelled order=%d key=%s team=%d warehouse=%d (%s)",
			c.GetOrderId(), c.GetIdempotencyKey(), c.GetTeamId(), c.GetWarehouseId(), event.GetEventId()), true
	}

	return "", false
}

// NewReleaseInventory is inventory_service as `pubsub releases replay` needs it: the release by key and nothing else.
// No poster, no product reader, no photo linker — a release writes the order transaction's rollback in inventory's own
// tables, and its events fall to EmptySender.
func NewReleaseInventory(db *gorm.DB) *inventory_v1.Service {
	return inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil)
}

// pubsubReleasesCommand is `san pubsub releases list|replay`.
func pubsubReleasesCommand() *cli.Command {
	quiet := &cli.DurationFlag{
		Name:  "quiet",
		Usage: "stop reading a dead-letter after this long with no new message",
		Value: 5 * time.Second,
	}

	queue := func(ctx context.Context, cmd *cli.Command) (pubsubDeadLetters, func(), error) {
		client, err := pubsubClient(ctx, cmd, cmd.String("project"))
		if err != nil {
			return pubsubDeadLetters{}, nil, err
		}

		return pubsubDeadLetters{client: client, quiet: cmd.Duration("quiet")}, func() { _ = client.Close() }, nil
	}

	return &cli.Command{
		Name:  "releases",
		Usage: "list and replay the dead-lettered stock releases (InventoryTxCancel, OrderCancelled)",
		Commands: []*cli.Command{
			{
				Name:  "list",
				Usage: "print every stuck release in the two dead-letters, touch nothing",
				Flags: []cli.Flag{quiet},
				Action: func(ctx context.Context, cmd *cli.Command) error {
					q, done, err := queue(ctx, cmd)
					if err != nil {
						return err
					}

					defer done()

					_, err = stuckReleases{out: os.Stdout, queue: q, project: cmd.String("project"), mode: releasesList}.run(ctx)

					return err
				},
			},
			{
				Name: "replay",
				Usage: "give every stuck release back through inventory's own listener, and remove each that succeeds " +
					"from the dead-letter",
				Flags: []cli.Flag{
					quiet,
					&cli.BoolFlag{Name: "dry-run", Usage: "print what would be replayed, release nothing, remove nothing"},
				},
				Action: func(ctx context.Context, cmd *cli.Command) error {
					q, done, err := queue(ctx, cmd)
					if err != nil {
						return err
					}

					defer done()

					run := stuckReleases{out: os.Stdout, queue: q, project: cmd.String("project"), mode: releasesDryRun}

					if cmd.Bool("dry-run") {
						_, err = run.run(ctx)

						return err
					}

					// The DATABASE is chosen only for a real replay — the Local/Production prompt (or --dsn), as every
					// command that writes.
					return withSan(ctx, cmd, func(ctx context.Context, san *San) error {
						fmt.Printf("replaying into %s\n", san.target)

						run.mode = releasesReplay
						run.release = inventory_service.NewInventoryPushHandler(san.inventory)

						sum, err := run.run(ctx)
						if err != nil {
							return err
						}

						if sum.Failed > 0 {
							return fmt.Errorf("%d releases still fail — fix the cause (a stock count still open?) and run again", sum.Failed)
						}

						return nil
					})
				},
			},
		},
	}
}
