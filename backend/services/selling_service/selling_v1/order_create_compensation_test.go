package selling_v1_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// THE COMPENSATION OF A FAILED CREATE (backlog #10 slice 3): the take runs first, under the order's key K, and any
// failure after it was called — a KEY_USED refusal excepted (a-used-key-is-never-cancelled) — releases it directly,
// under a context the browser cannot cancel, and then publishes InventoryTxCancel{K} as the backup
// (the-compensation-event-is-inventory-tx-cancel, the-release-is-direct-then-the-event).

// compensationService is a service with the given picker, event recorder and fee pricer (nil = prices nothing).
func compensationService(db *gorm.DB, picker *fakePicker, rec *recorder, fees selling_v1.WarehouseFeePricer) *selling_v1.Service {
	return selling_v1.NewService(db, picker, rec.send, &fakeCatalog{}, &fakeCredit{}, everyoneMayWrite{}, nil, fees, nil)
}

// txCancels is every InventoryTxCancel the recorder saw.
func (r *recorder) txCancels() []*eventsv1.InventoryTxCancel {
	var out []*eventsv1.InventoryTxCancel

	for _, e := range r.events {
		if c := e.GetInventoryTxCancel(); c != nil {
			out = append(out, c)
		}
	}

	return out
}

// assertCompensated checks the one shape every compensated failure leaves: no order, the take released ONCE under K
// with a live context, and exactly one InventoryTxCancel naming K, the team and the warehouse — its envelope keyed on K.
func assertCompensated(t *testing.T, db *gorm.DB, picker *fakePicker, rec *recorder, key string, teamID uint64) {
	t.Helper()

	if n := countOrders(t, db); n != 0 {
		t.Fatalf("%d orders written — a failed create must leave none", n)
	}

	if len(picker.returned) != 1 || picker.returned[0] != key {
		t.Fatalf("released %v, want exactly one direct release under the order's key %q", picker.returned, key)
	}

	if !picker.live[0] {
		t.Fatal("the direct release ran under a cancelled context — it must run under one the browser cannot cancel")
	}

	cancels := rec.txCancels()
	if len(cancels) != 1 {
		t.Fatalf("published %d InventoryTxCancel, want exactly 1 backup", len(cancels))
	}

	c := cancels[0]
	if c.GetIdempotencyKey() != key || c.GetTeamId() != teamID || c.GetWarehouseId() != testWarehouse || c.GetReason() == "" {
		t.Fatalf("InventoryTxCancel = %+v — want key %q, team %d, warehouse %d and a reason", c, key, teamID, testWarehouse)
	}

	for _, e := range rec.events {
		if e.GetInventoryTxCancel() != nil && e.GetEventId() != "inventory-tx-cancel:"+key {
			t.Fatalf("event_id %q, want inventory-tx-cancel:%s (inventory-tx-cancel-is-an-order-event)", e.GetEventId(), key)
		}

		if e.GetOrderPlaced() != nil {
			t.Fatal("a failed create announced an OrderPlaced")
		}
	}
}

// THE FEE PRICER FAILS AFTER THE TAKE: no order, the stock released once by K, one InventoryTxCancel{K}.
func TestOrderCreate_AFeeFailureAfterTheTakeReleasesItAndPublishesTheCancel(t *testing.T) {
	db := san_testdb.DB(t)
	picker := knownCosts()
	rec := &recorder{}
	fees := &fakeFees{err: connect.NewError(connect.CodeFailedPrecondition, errors.New("Gudang A has not set its fee"))}
	svc := compensationService(db, picker, rec, fees)
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")
	req := feeOrderReq(shop)

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("err = %v, want the fee's FailedPrecondition", err)
	}

	if len(picker.picked) != 1 || picker.picked[0] != req.GetIdempotencyKey() {
		t.Fatalf("picked %v, want one take under the order's key", picker.picked)
	}

	assertCompensated(t, db, picker, rec, req.GetIdempotencyKey(), 2)
}

// THE DRAFT WAS PROMOTED MEANWHILE: the draft's delete finds nothing after the take — another Promote won — so this order
// rolls back, answered Aborted, and its take is released and cancelled exactly as a fee failure's is.
func TestOrderCreateFromDraft_ADraftConflictAfterTheTakeReleasesIt(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{}
	rec := &recorder{}
	svc := compensationService(db, picker, rec, nil)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	draftID := readyDraft(t, svc, db, shop)

	// The other Promote, landing while this one's take is in flight.
	picker.onPick = func(context.Context) {
		err := db.Where("id = ?", draftID).Delete(&selling_service_models.OrderDraft{}).Error
		if err != nil {
			t.Fatalf("delete the draft under the take: %v", err)
		}
	}

	_, err := promote(t, svc, draftPusher, 2, draftID)
	if connect.CodeOf(err) != connect.CodeAborted {
		t.Fatalf("err = %v, want Aborted — the draft was already turned into an order", err)
	}

	if len(picker.picked) != 1 {
		t.Fatalf("picked %v, want one take", picker.picked)
	}

	assertCompensated(t, db, picker, rec, picker.picked[0], 2)

	if actor := rec.txCancels()[0].GetActorId(); actor != draftPusher {
		t.Fatalf("the cancel names actor %d, want %d — who placed the failed order", actor, draftPusher)
	}
}

// THE PERSON LEAVES DURING THE TAKE: the request is cancelled while the take is in flight, and the take answers with the
// cancellation — it may still have committed on the other side. The release runs anyway, under a live context.
func TestOrderCreate_ARequestCancelledDuringTheTakeStillReleasesIt(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	picker := &fakePicker{}
	svc := compensationService(db, picker, rec, nil)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	req := orderReq(shop)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	picker.onPick = func(context.Context) { cancel() }
	picker.pickErr = context.Canceled

	_, err := svc.OrderCreate(ctx, connect.NewRequest(req))
	if err == nil {
		t.Fatal("a create whose take never answered succeeded")
	}

	assertCompensated(t, db, picker, rec, req.GetIdempotencyKey(), 2)
}

// THE PERSON LEAVES JUST AFTER THE TAKE: the take answered, then the request was cancelled, so the order's transaction
// cannot run. The take is released all the same — the context the release runs under is not the browser's.
func TestOrderCreate_ARequestCancelledAfterTheTakeStillReleasesIt(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	picker := &fakePicker{}
	svc := compensationService(db, picker, rec, nil)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	req := orderReq(shop)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	picker.onPick = func(context.Context) { cancel() }

	_, err := svc.OrderCreate(ctx, connect.NewRequest(req))
	if err == nil {
		t.Fatal("a create cancelled after its take succeeded")
	}

	if len(picker.picked) != 1 {
		t.Fatalf("picked %v, want the one take that answered", picker.picked)
	}

	assertCompensated(t, db, picker, rec, req.GetIdempotencyKey(), 2)
}

// A KEY ALREADY USED IS NEVER COMPENSATED (a-used-key-is-never-cancelled): the key is another submit's live take, so
// nothing is released and nothing is published — the order fails with the refusal, as it came.
func TestOrderCreate_AKeyUsedRefusalReleasesAndPublishesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}

	used := connect.NewError(connect.CodeAlreadyExists, errors.New("order transaction refused: KEY_USED"))

	detail, err := connect.NewErrorDetail(&inventoryv1.OrderTransactionRefusal{
		Reason: inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_KEY_USED,
	})
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	used.AddDetail(detail)

	picker := &fakePicker{pickErr: used}
	svc := compensationService(db, picker, rec, nil)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	_, err = svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if refusalIn(t, err).GetReason() != inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_KEY_USED ||
		connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("err = %v, want the take's AlreadyExists KEY_USED as it came", err)
	}

	if picker.calls != 1 || len(picker.returned) != 0 || len(picker.live) != 0 {
		t.Fatalf("take called %d times, released %v — a used key must never be released", picker.calls, picker.returned)
	}

	if len(rec.events) != 0 {
		t.Fatalf("published %v — a used key must never be cancelled", rec.events)
	}

	assertNoOrders(t, db)
}

// A STOCK REFUSAL: no order. The take was CALLED, so the decided compensation still runs — a release of a key nothing was
// taken under claims it, so a late take is refused — and the refusal reaches the caller as it came.
func TestOrderCreate_AStockRefusalWritesNoOrderAndStillReleasesByTheKey(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	picker := &fakePicker{pickErr: takeRefused(t,
		inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_NOT_ENOUGH_STOCK,
		&inventoryv1.OrderTransactionRefusedLine{ProductId: 100, Wanted: 3, Available: 1},
	)}
	svc := compensationService(db, picker, rec, nil)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	req := orderReq(shop)

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("err = %v, want the take's FailedPrecondition", err)
	}

	assertCompensated(t, db, picker, rec, req.GetIdempotencyKey(), 2)
}

// THE PUBLISH FAILS: the direct release has already run — the event is only the backup — and the caller still hears
// the order's own failure, not the broker's.
func TestOrderCreate_APublishFailureStillLeavesTheDirectRelease(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{fail: errors.New("broker down")}
	picker := knownCosts()
	fees := &fakeFees{err: connect.NewError(connect.CodeFailedPrecondition, errors.New("Gudang A has not set its fee"))}
	svc := compensationService(db, picker, rec, fees)
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")
	req := feeOrderReq(shop)

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("err = %v, want the fee's FailedPrecondition — never the broker's failure", err)
	}

	if len(picker.returned) != 1 || picker.returned[0] != req.GetIdempotencyKey() || !picker.live[0] {
		t.Fatalf("released %v (live %v), want one direct release under the order's key", picker.returned, picker.live)
	}

	if n := countOrders(t, db); n != 0 {
		t.Fatalf("%d orders written", n)
	}
}

// THE DIRECT RELEASE FAILS: the event still goes out — that is what it is the backup for.
func TestOrderCreate_AFailedDirectReleaseStillPublishesTheCancel(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	picker := knownCosts()
	picker.returnErr = connect.NewError(connect.CodeUnavailable, errors.New("inventory unreachable"))
	fees := &fakeFees{err: connect.NewError(connect.CodeFailedPrecondition, errors.New("Gudang A has not set its fee"))}
	svc := compensationService(db, picker, rec, fees)
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")
	req := feeOrderReq(shop)

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("err = %v, want the fee's FailedPrecondition", err)
	}

	if cancels := rec.txCancels(); len(cancels) != 1 || cancels[0].GetIdempotencyKey() != req.GetIdempotencyKey() {
		t.Fatalf("published %v, want the one InventoryTxCancel backup for the failed direct release", cancels)
	}
}

// A PLACED ORDER ANNOUNCES ITS KEY AND ITS TRANSACTION, and publishes no cancel.
func TestOrderCreate_OrderPlacedCarriesTheKeyAndTheTransaction(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	picker := &fakePicker{txID: 5150}
	svc := compensationService(db, picker, rec, nil)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	req := orderReq(shop)

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	placed := rec.placed(t)
	if placed.GetIdempotencyKey() != req.GetIdempotencyKey() || placed.GetTransactionId() != 5150 {
		t.Fatalf("OrderPlaced carries key %q and transaction %d, want %q and 5150", placed.GetIdempotencyKey(),
			placed.GetTransactionId(), req.GetIdempotencyKey())
	}

	if len(picker.returned) != 0 {
		t.Fatalf("a placed order released %v", picker.returned)
	}
}
