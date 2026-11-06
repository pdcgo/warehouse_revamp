package main

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// a-stuck-release-is-replayed-by-san — `san pubsub releases`, driven over a fake dead-letter.

// fakeDeadLetters is two dead-letters held in memory: Drain hands each waiting message to fn once and removes the ones it
// ACKs, exactly as the triage subscription would.
type fakeDeadLetters struct {
	waiting map[string][]deadLetter
	acked   []string
}

func (f *fakeDeadLetters) Drain(_ context.Context, topic string, fn func(deadLetter) bool) error {
	kept := make([]deadLetter, 0, len(f.waiting[topic]))

	for _, m := range f.waiting[topic] {
		if fn(m) {
			f.acked = append(f.acked, m.ID)

			continue
		}

		kept = append(kept, m)
	}

	f.waiting[topic] = kept

	return nil
}

func encodeEvent(t *testing.T, event *eventsv1.Event) []byte {
	t.Helper()

	data, err := protojson.Marshal(event)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	return data
}

func txCancelLetter(t *testing.T, id, key string) deadLetter {
	return deadLetter{ID: id, Attempts: 5, Data: encodeEvent(t, &eventsv1.Event{
		EventId:     "inventory-tx-cancel:" + key,
		OccurredAt:  timestamppb.Now(),
		AggregateId: "order-key:" + key,
		Message: &eventsv1.Event_InventoryTxCancel{InventoryTxCancel: &eventsv1.InventoryTxCancel{
			IdempotencyKey: key, TeamId: 12, WarehouseId: 11, ActorId: 3, Reason: "the order was not written",
		}},
	})}
}

func orderCancelledLetter(t *testing.T, id, key string, attrs map[string]string) deadLetter {
	return deadLetter{ID: id, Attempts: 5, Attributes: attrs, Data: encodeEvent(t, &eventsv1.Event{
		EventId:     "order-cancelled:" + key,
		OccurredAt:  timestamppb.Now(),
		AggregateId: "order:77",
		Message: &eventsv1.Event_OrderCancelled{OrderCancelled: &eventsv1.OrderCancelled{
			TeamId: 12, OrderId: 77, ActorId: 3, ShopId: 4, IdempotencyKey: key, WarehouseId: 11,
		}},
	})}
}

// The two dead-letters a run reads: a stuck InventoryTxCancel; and on order-cancelled, inventory's stuck release beside
// SETTLEMENT's dead-letter of the same kind of event and a message that is no release at all.
func stuckFixture(t *testing.T) *fakeDeadLetters {
	t.Helper()

	return &fakeDeadLetters{waiting: map[string][]deadLetter{
		"inventory-tx-cancel": {txCancelLetter(t, "m1", "K-tx")},
		"order-cancelled": {
			// As Pub/Sub stamps them: the source subscription's SHORT id, and its project.
			orderCancelledLetter(t, "m2", "K-cancel", map[string]string{
				deadLetterSourceAttribute: "inventory-order-cancelled", deadLetterSourceProjectAttribute: "p",
			}),
			orderCancelledLetter(t, "m3", "K-settlement", map[string]string{
				deadLetterSourceAttribute: "settlement-order-cancelled", deadLetterSourceProjectAttribute: "p",
			}),
			{ID: "m4", Data: []byte(`{"not":"an event"}`)},
		},
	}}
}

// LIST and DRY-RUN touch nothing: every stuck release is named with its key, team and warehouse, nothing is released,
// nothing leaves the dead-letter — and the other consumer's dead-letter and the junk are said to be left.
func TestReleases_ListAndDryRunTouchNothing(t *testing.T) {
	for _, mode := range []releaseMode{releasesList, releasesDryRun} {
		queue := stuckFixture(t)

		var out bytes.Buffer

		// No release handler: calling it would panic, which is the proof nothing was released.
		sum, err := stuckReleases{out: &out, queue: queue, project: "p", mode: mode}.run(context.Background())
		if err != nil {
			t.Fatalf("mode %d: %v", mode, err)
		}

		if sum.Found != 2 || sum.Released != 0 || sum.Left != 2 || len(queue.acked) != 0 {
			t.Fatalf("mode %d: summary %+v, acked %v — want 2 found, none released, nothing acked", mode, sum, queue.acked)
		}

		text := out.String()
		for _, want := range []string{
			"InventoryTxCancel key=K-tx team=12 warehouse=11",
			"OrderCancelled order=77 key=K-cancel team=12 warehouse=11",
			"dead-lettered by settlement-order-cancelled — not a release",
			"m4  cannot be decoded",
		} {
			if !strings.Contains(text, want) {
				t.Fatalf("mode %d: output lacks %q:\n%s", mode, want, text)
			}
		}

		if strings.Contains(text, "K-settlement · ") {
			t.Fatalf("mode %d: settlement's dead-letter was offered as a release:\n%s", mode, text)
		}
	}
}

// REPLAY releases each stuck release through the handler, ACKs the ones that succeed and leaves a failure where it was —
// and never touches the other consumer's dead-letter. A second run finds only the failure.
func TestReleases_ReplayAcksWhatSucceedsAndLeavesAFailure(t *testing.T) {
	queue := stuckFixture(t)

	var asked []string

	release := func(_ context.Context, event *eventsv1.Event) error {
		asked = append(asked, event.GetEventId())

		if event.GetInventoryTxCancel() != nil {
			return errors.New("waits for the stock count")
		}

		return nil
	}

	var out bytes.Buffer

	sum, err := stuckReleases{out: &out, queue: queue, project: "p", mode: releasesReplay, release: release}.
		run(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	if sum.Found != 2 || sum.Released != 1 || sum.Failed != 1 || sum.Left != 2 {
		t.Fatalf("summary %+v, want 1 replayed, 1 failing, 2 left", sum)
	}

	if len(queue.acked) != 1 || queue.acked[0] != "m2" {
		t.Fatalf("acked %v, want only inventory's OrderCancelled", queue.acked)
	}

	if !strings.Contains(out.String(), "STILL FAILS, left in the dead-letter: waits for the stock count") {
		t.Fatalf("the failure is not said:\n%s", out.String())
	}

	asked = nil

	sum, err = stuckReleases{out: &out, queue: queue, project: "p", mode: releasesReplay, release: release}.
		run(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	if sum.Found != 1 || len(asked) != 1 || asked[0] != "inventory-tx-cancel:K-tx" {
		t.Fatalf("second run: %+v, asked %v — want only the failing release again", sum, asked)
	}
}

// THROUGH INVENTORY'S OWN LISTENER, TWICE: a stuck OrderCancelled whose take never landed claims its key with none, and
// replaying the same event again (it was put back in the dead-letter) is a no-op — one claim, no transaction, no error.
func TestReleases_ReplayThroughInventoryIsSafeTwice(t *testing.T) {
	db := san_testdb.DB(t)
	handler := inventory_service.NewInventoryPushHandler(NewReleaseInventory(db))

	for round := range 2 {
		queue := &fakeDeadLetters{waiting: map[string][]deadLetter{
			"order-cancelled": {orderCancelledLetter(t, "m1", "K-san-twice", nil)},
		}}

		var out bytes.Buffer

		sum, err := stuckReleases{out: &out, queue: queue, project: "p", mode: releasesReplay, release: handler}.
			run(context.Background())
		if err != nil {
			t.Fatalf("round %d: %v", round, err)
		}

		if sum.Released != 1 || sum.Failed != 0 || len(queue.acked) != 1 {
			t.Fatalf("round %d: %+v, acked %v\n%s", round, sum, queue.acked, out.String())
		}
	}

	var claims []inventory_service_models.IdempotencyOrderCheck

	err := db.Where("idempotency_key = ?", "K-san-twice").Find(&claims).Error
	if err != nil {
		t.Fatal(err)
	}

	if len(claims) != 1 || claims[0].TransactionID != nil {
		t.Fatalf("claims = %+v, want one claim with no transaction", claims)
	}
}

// WHOSE DEAD-LETTER: Pub/Sub names the source by its short id beside its project; a full path is read too, another
// project's same-named subscription is not ours, and a message with no source (put there by hand) is taken as a release.
func TestReleases_TheSourceSubscriptionDecidesWhoseItIs(t *testing.T) {
	cases := []struct {
		name  string
		attrs map[string]string
		own   bool
	}{
		{"short id, this project", map[string]string{deadLetterSourceAttribute: "inventory-tx-cancel", deadLetterSourceProjectAttribute: "p"}, true},
		{"full path", map[string]string{deadLetterSourceAttribute: "projects/p/subscriptions/inventory-tx-cancel"}, true},
		{"another consumer", map[string]string{deadLetterSourceAttribute: "settlement-order-cancelled", deadLetterSourceProjectAttribute: "p"}, false},
		{"another project", map[string]string{deadLetterSourceAttribute: "inventory-tx-cancel", deadLetterSourceProjectAttribute: "q"}, false},
		{"put there by hand", nil, true},
	}

	for _, c := range cases {
		own, _ := fromOwnSubscription(c.attrs, "p", "inventory-tx-cancel")
		if own != c.own {
			t.Fatalf("%s: own = %v, want %v", c.name, own, c.own)
		}
	}
}
