package inventory_v1_test

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"gorm.io/gorm"
)

// recordingSender keeps what the accept published, and can be made to fail as a dead broker would.
type recordingSender struct {
	sent []*eventsv1.Event
	err  error
}

func (r *recordingSender) send(_ context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
	if r.err != nil {
		return r.err
	}

	r.sent = append(r.sent, event)

	return nil
}

const (
	acceptSellingTeam uint64 = 2
	acceptWarehouse   uint64 = 5
	acceptSupplier    uint64 = 31
)

// createTwoLines raises a restock from supplier 31: 10 of product 100 for Rp 100.000, 5 of product 200 for Rp 25.000.
// Both lines name the supplier — it rides each line (a-line-connects-to-any-teams-supplier-from-a-popup).
func createTwoLines(t *testing.T, svc *inventory_v1.Service) *inventoryv1.RestockRequest {
	t.Helper()

	created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: acceptSellingTeam, WarehouseId: acceptWarehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 10, Total: 100000, SupplierId: acceptSupplier},
			{ProductId: 200, Sku: "SKU2", Name: "Gadget", Count: 5, Total: 25000, SupplierId: acceptSupplier},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	return created.Msg.GetRequest()
}

func newAcceptService(db *gorm.DB, sender *recordingSender) *inventory_v1.Service {
	return inventory_v1.NewService(db, nil, nil, fakeSuppliers{acceptSupplier: true}, sender.send)
}

// The accept announces what it COUNTED (each-figure-is-read-at-the-accept): per line the good units, the broken and
// the short — missing and broken BESIDE accepted, never inside it — the ordered count and the total, the line's and
// the restock's supplier and team, and the accept's Jakarta day and instant (restock-accepted-carries-every-line).
// The short unit is MISSING, worked out as count − received (a-short-unit-at-the-door-is-missing).
func TestRestockRequestAccept_PublishesRestockAccepted(t *testing.T) {
	db := san_testdb.DB(t)
	sender := &recordingSender{}
	svc := newAcceptService(db, sender)

	req := createTwoLines(t, svc)
	first, second := req.GetItems()[0], req.GetItems()[1]
	staging := stagingPlacement(t, db, acceptWarehouse)

	before := time.Now().Unix()

	_, err := svc.RestockRequestAccept(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: acceptWarehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{
				// 10 ordered: 9 in the box — 7 good, 2 broken — and the 1 short is worked out, not typed.
				ItemId: first.GetId(), ReceivedCount: 9,
				BrokenCount: 2, BrokenNote: "crushed", MissingNote: "short",
				Placements: placedOn(staging, 7),
			},
			{
				ItemId: second.GetId(), ReceivedCount: 5,
				Placements: placedOn(staging, 5),
			},
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	if len(sender.sent) != 1 {
		t.Fatalf("published %d events, want 1", len(sender.sent))
	}

	event := sender.sent[0]
	accepted := event.GetRestockAccepted()

	if event.GetEventId() != "restock-accepted:"+strconv.FormatUint(req.GetId(), 10) {
		t.Fatalf("event_id = %q — it must be derived from the restock, so a republish collides in the fold", event.GetEventId())
	}

	today := time.Now().In(time.FixedZone("WIB", 7*60*60)).Format("2006-01-02")

	if accepted.GetTeamId() != acceptSellingTeam || accepted.GetWarehouseId() != acceptWarehouse ||
		accepted.GetSupplierId() != acceptSupplier || accepted.GetAcceptedOn() != today {
		t.Fatalf("header = team %d, warehouse %d, supplier %d, on %s — want %d, %d, %d, %s",
			accepted.GetTeamId(), accepted.GetWarehouseId(), accepted.GetSupplierId(), accepted.GetAcceptedOn(),
			acceptSellingTeam, acceptWarehouse, acceptSupplier, today)
	}

	if at := accepted.GetAcceptedAtUnix(); at < before || at > time.Now().Unix() {
		t.Fatalf("accepted_at_unix = %d, want the accept's instant, inside [%d, now]", at, before)
	}

	type line struct{ product, ordered, total, accepted, broken, missing, supplier int64 }

	want := []line{
		{100, 10, 100000, 7, 2, 1, int64(acceptSupplier)},
		{200, 5, 25000, 5, 0, 0, int64(acceptSupplier)},
	}

	if len(accepted.GetLines()) != len(want) {
		t.Fatalf("%d lines, want %d", len(accepted.GetLines()), len(want))
	}

	for i, l := range accepted.GetLines() {
		got := line{
			int64(l.GetProductId()),
			l.GetOrderedCount(),
			l.GetTotalPrice(),
			l.GetAcceptedCount(),
			l.GetBrokenCount(),
			l.GetMissingCount(),
			int64(l.GetSupplierId()),
		}
		if got != want[i] {
			t.Fatalf("line %d = %+v, want %+v", i, got, want[i])
		}
	}
}

// An accept that is REFUSED announces nothing — an event for goods that never went on the shelf would fold figures
// for a delivery the warehouse did not take.
func TestRestockRequestAccept_ARefusedAcceptPublishesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	sender := &recordingSender{}
	svc := newAcceptService(db, sender)

	req := createTwoLines(t, svc)

	// Only one of the two lines counted — refused as incomplete (#133).
	_, err := svc.RestockRequestAccept(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: acceptWarehouse, RequestId: req.GetId(),
		Lines: allArrived(t, db, &inventoryv1.RestockRequest{WarehouseId: acceptWarehouse, Items: req.GetItems()[:1]}),
	}))
	if err == nil {
		t.Fatal("an incomplete count was accepted")
	}

	if len(sender.sent) != 0 {
		t.Fatalf("a refused accept published %d events", len(sender.sent))
	}
}

// A dead broker does not fail the accept (no-outbox-the-publish-is-trusted): the goods are on the shelf, and that is
// the truth the warehouse needs recorded.
func TestRestockRequestAccept_APublishFailureDoesNotFailTheAccept(t *testing.T) {
	db := san_testdb.DB(t)
	sender := &recordingSender{err: errors.New("broker unreachable")}
	svc := newAcceptService(db, sender)

	req := createTwoLines(t, svc)

	ful, err := svc.RestockRequestAccept(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: acceptWarehouse, RequestId: req.GetId(),
		Lines: allArrived(t, db, req),
	}))
	if err != nil {
		t.Fatalf("the accept failed with the broker: %v", err)
	}

	if ful.Msg.GetRequest().GetStatus() != accepted {
		t.Fatalf("status = %v, want accepted", ful.Msg.GetRequest().GetStatus())
	}
}
