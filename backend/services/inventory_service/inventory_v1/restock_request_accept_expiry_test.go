package inventory_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE EXPIRY TYPED AT THE ACCEPT (the-warehouse-types-the-expiry-at-the-accept): the receiving warehouse reads each
// line's date off the box — optional, one per line, a Jakarta day — and it lands on the batch that line mints
// (`batches.expired_at`, that day's Jakarta midnight). A line with no date mints as before; a line with no good unit
// mints no batch, so its date is stored nowhere. A past day is accepted (the-expiry-prototypes-are-accepted).

const expiryWarehouse uint64 = 5

// jakartaDayIn is the Jakarta day `days` from today, as the accept line carries it, and its Jakarta midnight.
func jakartaDayIn(days int) (string, time.Time) {
	today := time.Now().In(wibZone)
	midnight := time.Date(today.Year(), today.Month(), today.Day()+days, 0, 0, 0, 0, wibZone)

	return midnight.Format("2006-01-02"), midnight
}

// expiryRestock raises a restock for team 2 at the warehouse with the lines given (product → count, each Rp 10.000 a
// unit, no freight), and a rack to put them on.
func expiryRestock(t *testing.T, svc *inventory_v1.Service, counts map[uint64]int64, order []uint64) (*inventoryv1.RestockRequest, uint64) {
	t.Helper()

	rack := newRack(t, svc, expiryWarehouse, "A-01")

	items := make([]*inventoryv1.RestockRequestItem, 0, len(order))
	for _, product := range order {
		items = append(items, &inventoryv1.RestockRequestItem{
			ProductId: product, ProductCode: "SKU-" + itoa(product), Name: "Produk " + itoa(product),
			Count: counts[product], Total: float64(counts[product]) * 10000,
		})
	}

	created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: expiryWarehouse, Items: items,
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	return created.Msg.GetRequest(), rack
}

// countedLine is one accept line: received, broken, every good unit on the rack, and the expiry day ("" = none).
func countedLine(item *inventoryv1.RestockRequestItem, received, broken int64, rack uint64, expiresOn string) *inventoryv1.RestockRequestReceivedLine {
	line := &inventoryv1.RestockRequestReceivedLine{
		ItemId: item.GetId(), ReceivedCount: received, BrokenCount: broken, ExpiresOn: expiresOn,
	}

	if good := received - broken; good > 0 {
		line.Placements = []*inventoryv1.RestockPlacement{{PlacementId: rack, Quantity: good}}
	}

	return line
}

// storedExpiry is the warehouse's batches of a product and each one's stored expiry (nil = none).
func storedExpiry(t *testing.T, db *gorm.DB, product uint64) []*time.Time {
	t.Helper()

	var rows []struct{ ExpiredAt *time.Time }

	err := db.Raw(`SELECT expired_at FROM batches WHERE warehouse_id = ? AND product_id = ? ORDER BY id`, expiryWarehouse, product).
		Scan(&rows).
		Error
	if err != nil {
		t.Fatal(err)
	}

	out := make([]*time.Time, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.ExpiredAt)
	}

	return out
}

// listedExpiry is what the warehouse's Batch list says each product's batch expires on (unix; 0 = none).
func listedExpiry(t *testing.T, svc *inventory_v1.Service) map[uint64]int64 {
	t.Helper()

	res, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: expiryWarehouse, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}

	out := map[uint64]int64{}
	for _, b := range batchRows(res.Msg) {
		out[b.GetProductId()] = b.GetExpiresOnUnix()
	}

	return out
}

// One restock, four lines: a line with a date in 20 days whose box also held broken units (the date goes on its good
// units' batch), a line with no date (no expiry, as today), a line where nothing arrived but a date was typed, and one
// whose every unit was broken with a date — neither of the last two mints a batch, so their dates are stored nowhere.
// The warehouse's Batch list and the owning team's product page (OwnerBatchList) read the date back as that day.
func TestRestockRequestAccept_TheExpiryGoesOnTheLinesBatch(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const (
		dated       uint64 = 100
		undated     uint64 = 200
		nothingCame uint64 = 300
		allBroken   uint64 = 400
	)

	order := []uint64{dated, undated, nothingCame, allBroken}
	req, rack := expiryRestock(t, svc, map[uint64]int64{dated: 10, undated: 6, nothingCame: 4, allBroken: 3}, order)
	items := req.GetItems()

	in20, midnight20 := jakartaDayIn(20)

	_, err := svc.RestockRequestAccept(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: expiryWarehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			countedLine(items[0], 10, 2, rack, in20),
			countedLine(items[1], 6, 0, rack, ""),
			countedLine(items[2], 0, 0, rack, in20),
			countedLine(items[3], 3, 3, rack, in20),
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	got := storedExpiry(t, db, dated)
	if len(got) != 1 || got[0] == nil || !got[0].Equal(midnight20) {
		t.Fatalf("the dated line's batch expires %v, want one batch at %s (that Jakarta day's midnight)", got, midnight20)
	}

	got = storedExpiry(t, db, undated)
	if len(got) != 1 || got[0] != nil {
		t.Fatalf("the undated line's batch expires %v, want one batch with no expiry", got)
	}

	for _, product := range []uint64{nothingCame, allBroken} {
		if got := storedExpiry(t, db, product); len(got) != 0 {
			t.Fatalf("product %d minted %d batch(es) — a line with no good unit mints none, so its date lands nowhere", product, len(got))
		}
	}

	var withExpiry int64

	db.Raw(`SELECT COUNT(*) FROM batches WHERE warehouse_id = ? AND expired_at IS NOT NULL`, expiryWarehouse).Scan(&withExpiry)

	if withExpiry != 1 {
		t.Fatalf("%d batches carry an expiry, want the dated line's alone", withExpiry)
	}

	listed := listedExpiry(t, svc)
	if listed[dated] != midnight20.Unix() || listed[undated] != 0 {
		t.Fatalf("the Batch list reads %v, want %d for the dated line and 0 for the other", listed, midnight20.Unix())
	}

	// The owning team's product page reads it from OwnerBatchList — the same StockBatch.expires_on_unix.
	owned := ownerBatches(t, svc, 2, dated, 0)
	if len(owned) != 1 || owned[0].GetExpiresOnUnix() != midnight20.Unix() {
		t.Fatalf("OwnerBatchList reads %+v, want one batch expiring %d", owned, midnight20.Unix())
	}

	owned = ownerBatches(t, svc, 2, undated, 0)
	if len(owned) != 1 || owned[0].GetExpiresOnUnix() != 0 {
		t.Fatalf("OwnerBatchList reads %+v for the undated line, want one batch with no expiry", owned)
	}
}

// With no date on any line the accept writes what it always wrote: every batch's expiry empty.
func TestRestockRequestAccept_NoExpiryMintsAsBefore(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	req, rack := expiryRestock(t, svc, map[uint64]int64{100: 5, 200: 5}, []uint64{100, 200})
	items := req.GetItems()

	_, err := svc.RestockRequestAccept(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: expiryWarehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			countedLine(items[0], 5, 0, rack, ""),
			countedLine(items[1], 5, 0, rack, ""),
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	for _, product := range []uint64{100, 200} {
		got := storedExpiry(t, db, product)
		if len(got) != 1 || got[0] != nil {
			t.Fatalf("product %d: batches %v, want one with no expiry", product, got)
		}
	}
}

// A PAST DAY IS ACCEPTED — a box can arrive already expired; the batch says so (it reads red on the screens) and is
// among the list's *Kedaluwarsa ≤ 30 hari*, which takes everything with units left that expires before the window's end.
func TestRestockRequestAccept_APastExpiryIsAccepted(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	req, rack := expiryRestock(t, svc, map[uint64]int64{100: 5}, []uint64{100})

	threeDaysAgo, midnight := jakartaDayIn(-3)

	_, err := svc.RestockRequestAccept(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: expiryWarehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{countedLine(req.GetItems()[0], 5, 0, rack, threeDaysAgo)},
	}))
	if err != nil {
		t.Fatalf("accept with a past expiry: %v — a past day is allowed", err)
	}

	got := storedExpiry(t, db, 100)
	if len(got) != 1 || got[0] == nil || !got[0].Equal(midnight) {
		t.Fatalf("batch expires %v, want %s", got, midnight)
	}

	soon, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: expiryWarehouse,
		Filter: &inventoryv1.BatchListFilter{Expiry: inventoryv1.BatchExpiryFilter_BATCH_EXPIRY_FILTER_EXPIRING_SOON},
		Page:   page1(),
	}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}

	if len(batchRows(soon.Msg)) != 1 || soon.Msg.GetExpiringSoonCount() != 1 {
		t.Fatalf("Kedaluwarsa ≤ 30 hari lists %d (count %d), want the expired batch", len(batchRows(soon.Msg)),
			soon.Msg.GetExpiringSoonCount())
	}
}

// A day of the right shape that is not on the calendar is refused, and nothing is written: the restock stays as it was.
func TestRestockRequestAccept_AnExpiryNotOnTheCalendarIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	req, rack := expiryRestock(t, svc, map[uint64]int64{100: 5}, []uint64{100})

	_, err := svc.RestockRequestAccept(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: expiryWarehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{countedLine(req.GetItems()[0], 5, 0, rack, "2026-02-30")},
	}))
	wantCode(t, err, connect.CodeInvalidArgument, "an expiry of 30 Feb")

	var batches int64

	db.Raw(`SELECT COUNT(*) FROM batches WHERE warehouse_id = ?`, expiryWarehouse).Scan(&batches)

	var status string

	db.Raw(`SELECT status FROM restocks WHERE id = ?`, req.GetId()).Scan(&status)

	if batches != 0 || status == "accepted" {
		t.Fatalf("after the refusal: %d batches, status %q — want nothing written", batches, status)
	}
}

// THE DATE TRAVELS WITH THE GOODS: a transfer's receiver mints one batch per source batch with its expiry
// (the-receiver-mints-one-batch-per-source-batch) — already so before this pass; here the date comes from the accept.
func TestRestockRequestAccept_TheExpiryTravelsWithATransfer(t *testing.T) {
	f := &wtFixture{sent: &sentEvents{}}
	f.db = san_testdb.DB(t)
	f.svc = inventory_v1.NewService(f.db, nil, nil, nil, f.sent.send, wtFacts(), nil, nil)

	f.rakA = newRack(t, f.svc, wtA, "rak-a")
	f.rakB1 = newRack(t, f.svc, wtB, "rak-b1")

	created, err := f.svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: otMelati, WarehouseId: wtA,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: wtKaosPolos, ProductCode: "KP-001", Name: "Kaos Polos", Count: 4, Total: 20000}},
	}))
	if err != nil {
		t.Fatalf("restock create: %v", err)
	}

	in45, midnight45 := jakartaDayIn(45)
	r := created.Msg.GetRequest()

	_, err = f.svc.RestockRequestAccept(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: wtA, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{countedLine(r.GetItems()[0], 4, 0, f.rakA, in45)},
	}))
	if err != nil {
		t.Fatalf("restock accept: %v", err)
	}

	tr := f.create(t, wtLine(wtKaosPolos, 3))
	f.ship(t, tr.GetId())

	_, err = f.accept(tr.GetId(), 0, "", counted(itemOf(t, tr, wtKaosPolos), 3, 0, f.rakB1))
	if err != nil {
		t.Fatalf("transfer accept: %v", err)
	}

	var atB []struct{ ExpiredAt *time.Time }

	err = f.db.Raw(`SELECT expired_at FROM batches WHERE warehouse_id = ? AND product_id = ?`, wtB, wtKaosPolos).Scan(&atB).Error
	if err != nil {
		t.Fatal(err)
	}

	if len(atB) != 1 || atB[0].ExpiredAt == nil || !atB[0].ExpiredAt.Equal(midnight45) {
		t.Fatalf("B's batch expires %+v, want the accept's %s carried over", atB, midnight45)
	}
}
