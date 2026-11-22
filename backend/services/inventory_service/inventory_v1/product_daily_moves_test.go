package inventory_v1_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// KELUAR MASUK HARIAN — a product's last fourteen Jakarta days (ProductDailyMoves; the-warehouse-zone-is-tabs,
// the-discover-detail-has-the-warehouse-zone): per day each change type's net units, Masuk, Keluar and Sisa, read from
// the daily fold every stock writer writes — here through the REAL writers, each on its own day (a stock transaction's
// clock, inventory_ledgers.WithNow). Melati owns Kaos Hitam; Sinar is another selling team reading it from Discover.
//
//	days ago   Gudang 5 (A)                                              Gudang 6 (B)
//	  20       restock 5 — before the window: only today's batches know it
//	  12       restock 20
//	   8                                                                 restock 6
//	   5       take 1 (noon, returned on day 3) · take 2 at 23:30 WIB
//	   4       take 1 at 00:30 WIB — the UTC date is still day 5's
//	   3       THE OWNER'S DAY: restock 12 · return 1 · take 5 · lost 1 at the shelf (opname −1) · 3 sent to B
//	   2       take 4 (cancelled the next day) · a sample of 1
//	   1       take 6 · the day-2 take of 4 cancelled (put back)
//	   0                                                                 the 3 received
//	Sinar's Kaos Merah is restocked at A on day 3 too — another product, never in Kaos Hitam's days.
//
// ⚠ HELD — Masuk/Keluar is drawn as option A (every movement by its direction: each change type's day net by its sign),
// the owner's Q2 still open; these tests pin option A.

type pdmFixture struct {
	svc  *inventory_v1.Service
	db   *gorm.DB
	rakA uint64
	rakB uint64
}

// pdmAt is `hour:minute` WIB `n` days before today — a stock transaction's clock.
func pdmAt(n, hour, minute int) time.Time {
	now := time.Now().In(metricWIB)

	return time.Date(now.Year(), now.Month(), now.Day(), hour, minute, 0, 0, metricWIB).AddDate(0, 0, -n)
}

func pdmService(t *testing.T) pdmFixture {
	t.Helper()

	db := san_testdb.DB(t)
	sent := &sentEvents{}
	svc := inventory_v1.NewService(db, &recordingPoster{}, &recordingExpense{}, nil, sent.send, wtFacts(), nil, nil, nil, nil)

	return pdmFixture{svc: svc, db: db, rakA: newRack(t, svc, wtA, "rak-pdm-a"), rakB: newRack(t, svc, wtB, "rak-pdm-b")}
}

// restock raises a restock of `product` for `team` into `warehouse` and accepts all of it, `n` days ago at noon.
func (f pdmFixture) restock(t *testing.T, n int, team, warehouse, rack, product uint64, count int64) {
	t.Helper()

	created, err := f.svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: team, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{{
			ProductId: product, ProductCode: "SKU", Name: "Kaos", Count: count, Total: float64(count * 10000),
		}},
	}))
	if err != nil {
		t.Fatalf("restock create: %v", err)
	}

	r := created.Msg.GetRequest()

	_, err = f.svc.RestockRequestAccept(on(ctxUser(1), n), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId: r.GetItems()[0].GetId(), ReceivedCount: count,
			Placements: []*inventoryv1.RestockPlacement{{PlacementId: rack, Quantity: count}},
		}},
	}))
	if err != nil {
		t.Fatalf("restock accept: %v", err)
	}
}

// take takes qty of Kaos Hitam at Gudang 5 for Melati's order `key`, at `at`, and returns the take's transaction.
func (f pdmFixture) take(t *testing.T, at time.Time, key string, qty int64) uint64 {
	t.Helper()

	res, err := f.svc.OrderTransactionCreate(inventory_ledgers.WithNow(ctxUser(8), at), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId: otMelati, IdempotencyKey: key, WarehouseId: wtA,
		Lines: []*inventoryv1.OrderTransactionLine{{ProductId: wtKaosHitam, Quantity: qty}},
	}))
	if err != nil {
		t.Fatalf("take %s: %v", key, err)
	}

	return res.Msg.GetTransactionId()
}

func (f pdmFixture) release(t *testing.T, n int, key string) {
	t.Helper()

	_, err := f.svc.OrderTransactionRelease(on(ctxUser(8), n), connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
		TeamId: otMelati, IdempotencyKey: key,
	}))
	if err != nil {
		t.Fatalf("release %s: %v", key, err)
	}
}

// pdmStocked writes the fixture's story (the table above).
func pdmStocked(t *testing.T) pdmFixture {
	t.Helper()

	f := pdmService(t)

	f.restock(t, 20, otMelati, wtA, f.rakA, wtKaosHitam, 5)
	f.restock(t, 12, otMelati, wtA, f.rakA, wtKaosHitam, 20)
	f.restock(t, 8, otMelati, wtB, f.rakB, wtKaosHitam, 6)

	returned := f.take(t, pdmAt(5, 12, 0), "pdm-ret", 1)
	f.take(t, pdmAt(5, 23, 30), "pdm-late", 2)
	f.take(t, pdmAt(4, 0, 30), "pdm-early", 1)

	// THE OWNER'S DAY — 12 restocked, 1 returned, 5 picked, opname −1, 3 sent to another warehouse.
	f.restock(t, 3, otMelati, wtA, f.rakA, wtKaosHitam, 12)

	_, err := f.svc.OrderTransactionReturn(on(ctxUser(8), 3), connect.NewRequest(&inventoryv1.OrderTransactionReturnRequest{
		TeamId: wtA, SellingTeamId: otMelati, TakeTransactionId: returned, Description: "return of pdm-ret",
		Lines: []*inventoryv1.OrderTransactionReturnLine{{
			ProductId: wtKaosHitam, ReturnProductId: wtKaosHitam, Sound: 1,
			Placements: []*inventoryv1.OrderTransactionReturnPlacement{{PlacementId: f.rakA, Quantity: 1}},
		}},
	}))
	if err != nil {
		t.Fatalf("return: %v", err)
	}

	f.take(t, pdmAt(3, 14, 0), "pdm-3", 5)

	var batch uint64

	err = f.db.
		Raw("SELECT id FROM batches WHERE product_id = ? AND warehouse_id = ? AND stock_count > 0 ORDER BY id LIMIT 1", wtKaosHitam, wtA).
		Scan(&batch).
		Error
	if err != nil || batch == 0 {
		t.Fatalf("a batch at A: %d, %v", batch, err)
	}

	_, err = f.svc.StockAdjust(on(opAdmin(51), 3), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: wtA, ProductId: wtKaosHitam, Place: &inventoryv1.StockAdjustRequest_RackId{RackId: f.rakA},
		ReasonType: inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_LOST, BatchId: batch, Quantity: 1,
		Reason: "not on the shelf at the count",
	}))
	if err != nil {
		t.Fatalf("lost 1: %v", err)
	}

	sent, err := f.svc.WarehouseTransferCreate(on(ctxUser(wtSeller), 3), connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
		TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB, Lines: []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosHitam, 3)},
		Note: "to B",
	}))
	if err != nil {
		t.Fatalf("send 3 to B: %v", err)
	}

	f.restock(t, 3, otSinar, wtA, f.rakA, wtKaosMerah, 9)

	f.take(t, pdmAt(2, 10, 0), "pdm-cancel", 4)

	_, err = f.svc.RackSample(on(ctxUser(8), 2), connect.NewRequest(&inventoryv1.RackSampleRequest{
		TeamId: wtA, RackId: f.rakA, Recipient: "Budi", Description: "a review video",
		Lines: []*inventoryv1.RackSampleLine{{ProductId: wtKaosHitam, Quantity: 1}},
	}))
	if err != nil {
		t.Fatalf("sample: %v", err)
	}

	f.take(t, pdmAt(1, 9, 0), "pdm-1", 6)
	f.release(t, 1, "pdm-cancel")

	transfer := sent.Msg.GetTransfer()
	wf := &wtFixture{svc: f.svc, db: f.db, sent: &sentEvents{}}
	wf.ship(t, transfer.GetId())

	_, err = f.svc.WarehouseTransferAccept(on(ctxUser(wtStaffB), 0), connect.NewRequest(&inventoryv1.WarehouseTransferAcceptRequest{
		TeamId: wtB, TransferId: transfer.GetId(), Lines: []*inventoryv1.WarehouseTransferCountedLine{
			counted(itemOf(t, transfer, wtKaosHitam), 3, 0, f.rakB),
		},
	}))
	if err != nil {
		t.Fatalf("receive the 3 at B: %v", err)
	}

	return f
}

func pdmRead(t *testing.T, f pdmFixture, team, product, warehouse uint64) []*inventoryv1.ProductDailyMove {
	t.Helper()

	res, err := f.svc.ProductDailyMoves(context.Background(), connect.NewRequest(&inventoryv1.ProductDailyMovesRequest{
		TeamId: team, Filter: &inventoryv1.ProductDailyMovesFilter{ProductId: product, WarehouseId: warehouse},
	}))
	if err != nil {
		t.Fatalf("ProductDailyMoves: %v", err)
	}

	return pdmDays(t, res.Msg)
}

// pdmDays is the answer's days in its order (today first), checked to be the fourteen days ending today.
func pdmDays(t *testing.T, res *inventoryv1.ProductDailyMovesResponse) []*inventoryv1.ProductDailyMove {
	t.Helper()

	var days []*inventoryv1.ProductDailyMove

	for _, it := range res.GetItems() {
		m := it.GetDay().GetMapData()
		for _, id := range res.GetIds() {
			days = append(days, m[id])
		}
	}

	if len(days) != 14 {
		t.Fatalf("%d days, want the last fourteen", len(days))
	}

	for i, d := range days {
		if d.GetId() != uint64(i+1) || d.GetDay() != dayOf(i) {
			t.Fatalf("day %d = id %d %s, want id %d %s (today first)", i, d.GetId(), d.GetDay(), i+1, dayOf(i))
		}
	}

	return days
}

// pdmWant is one day's figures, by how many days ago.
type pdmWant struct {
	in, out, onHand int64
	kinds           string
}

// pdmKinds names a day's kinds, `order-5 restock+12 …`.
func pdmKinds(d *inventoryv1.ProductDailyMove) string {
	var parts []string

	for _, k := range d.GetKinds() {
		name := strings.ToLower(strings.TrimPrefix(k.GetChangeType().String(), "STOCK_CHANGE_TYPE_"))
		parts = append(parts, fmt.Sprintf("%s%+d", name, k.GetUnits()))
	}

	return strings.Join(parts, " ")
}

// pdmCheck asserts every one of the fourteen days: those in `want` by how many days ago, every other day no movement
// and the Sisa of the day after it. And the BALANCE on every day: Sisa kemarin + Masuk − Keluar = Sisa.
func pdmCheck(t *testing.T, label string, days []*inventoryv1.ProductDailyMove, before int64, want map[int]pdmWant) {
	t.Helper()

	for i := len(days) - 1; i >= 0; i-- {
		d := days[i]
		w, ok := want[i]

		if !ok {
			w = pdmWant{onHand: before}
		}

		if d.GetInUnits() != w.in || d.GetOutUnits() != w.out || d.GetOnHand() != w.onHand || pdmKinds(d) != w.kinds {
			t.Fatalf("%s, %d days ago (%s): Masuk %d Keluar %d Sisa %d [%s] — want Masuk %d Keluar %d Sisa %d [%s]", label, i,
				d.GetDay(), d.GetInUnits(), d.GetOutUnits(), d.GetOnHand(), pdmKinds(d), w.in, w.out, w.onHand, w.kinds)
		}

		if before+d.GetInUnits()-d.GetOutUnits() != d.GetOnHand() {
			t.Fatalf("%s, %d days ago: %d + %d − %d ≠ Sisa %d", label, i, before, d.GetInUnits(), d.GetOutUnits(), d.GetOnHand())
		}

		before = d.GetOnHand()
	}
}

// THE OWNER'S DAY AND EVERY OTHER, at Gudang 5 — option A: 12 restocked + 1 returned in, 5 picked + 1 lost + 3 sent out,
// so Masuk 13 and Keluar 9 and the balance adds up. Day 2 is a take of 4 and a sample; day 1 a take of 6 with that take
// of 4 cancelled — its put-back nets in day 1's ONE order row and lowers day 1's Keluar to 2, leaving day 2 as it was.
// Day 20's restock sits before the window: day 13 already holds its 5, read back from today's batches.
func TestProductDailyMoves_EachDayAtTheWarehouse(t *testing.T) {
	f := pdmStocked(t)

	pdmCheck(t, "Gudang 5", pdmRead(t, f, otMelati, wtKaosHitam, wtA), 5, map[int]pdmWant{
		13: {onHand: 5},
		12: {in: 20, onHand: 25, kinds: "restock+20"},
		5:  {out: 3, onHand: 22, kinds: "order-3"},
		4:  {out: 1, onHand: 21, kinds: "order-1"},
		3:  {in: 13, out: 9, onHand: 25, kinds: "order-5 restock+12 return+1 transfer_out-3 lost-1"},
		2:  {out: 5, onHand: 20, kinds: "order-4 sample-1"},
		1:  {out: 2, onHand: 18, kinds: "order-2"},
		0:  {onHand: 18},
	})
}

// THE WAREHOUSE PICKER (the-warehouse-picker-splits-the-page): Gudang 6 holds only its restock of 6 and the 3 it
// received today; every warehouse holds both — the transfer is a Keluar at A on day 3 and a Masuk at B today, both
// under every warehouse.
func TestProductDailyMoves_TheWarehousePickerNarrowsTheDays(t *testing.T) {
	f := pdmStocked(t)

	pdmCheck(t, "Gudang 6", pdmRead(t, f, otMelati, wtKaosHitam, wtB), 0, map[int]pdmWant{
		8: {in: 6, onHand: 6, kinds: "restock+6"},
		0: {in: 3, onHand: 9, kinds: "transfer_in+3"},
	})

	pdmCheck(t, "every warehouse", pdmRead(t, f, otMelati, wtKaosHitam, 0), 5, map[int]pdmWant{
		13: {onHand: 5},
		12: {in: 20, onHand: 25, kinds: "restock+20"},
		8:  {in: 6, onHand: 31, kinds: "restock+6"},
		5:  {out: 3, onHand: 28, kinds: "order-3"},
		4:  {out: 1, onHand: 27, kinds: "order-1"},
		3:  {in: 13, out: 9, onHand: 31, kinds: "order-5 restock+12 return+1 transfer_out-3 lost-1"},
		2:  {out: 5, onHand: 26, kinds: "order-4 sample-1"},
		1:  {out: 2, onHand: 24, kinds: "order-2"},
		0:  {in: 3, onHand: 27, kinds: "transfer_in+3"},
	})
}

// SISA IS TODAY'S STOCK READ BACKWARDS: today's Sisa is exactly the owner's units on the shelves in the lens
// (OwnerStockByIds' ready), and every earlier day's is it less what moved since — the walk above. And the Jakarta
// day: the take at 23:30 WIB lands on day 5 and the one at 00:30 WIB on day 4, though both are day 5 in UTC.
func TestProductDailyMoves_SisaIsTodaysStockAndTheDayIsJakartas(t *testing.T) {
	f := pdmStocked(t)

	for _, warehouse := range []uint64{0, wtA, wtB} {
		days := pdmRead(t, f, otMelati, wtKaosHitam, warehouse)
		ready := ownerStock(t, f.svc, otMelati, warehouse, []uint64{wtKaosHitam})[wtKaosHitam].GetReadyQty()

		if days[0].GetOnHand() != ready {
			t.Fatalf("warehouse %d: today's Sisa %d, the shelves hold %d", warehouse, days[0].GetOnHand(), ready)
		}
	}

	if pdmAt(4, 0, 30).UTC().Format("2006-01-02") != pdmAt(5, 23, 30).UTC().Format("2006-01-02") {
		t.Fatal("the fixture's two late takes should share a UTC date")
	}

	days := pdmRead(t, f, otMelati, wtKaosHitam, wtA)
	if days[5].GetOutUnits() != 3 || days[4].GetOutUnits() != 1 {
		t.Fatalf("day 5 Keluar %d, day 4 Keluar %d — want 3 and 1 (each take on its Jakarta day)", days[5].GetOutUnits(),
			days[4].GetOutUnits())
	}
}

// A CANCEL ON A LATER DAY lands on its own day: the take of 4 stays day 2's Keluar, and day 1 nets the put-back with
// that day's take of 6 — Keluar 2. The days before never change.
func TestProductDailyMoves_ACancelOnALaterDayLandsOnItsDay(t *testing.T) {
	f := pdmService(t)

	f.restock(t, 5, otMelati, wtA, f.rakA, wtKaosHitam, 10)
	f.take(t, pdmAt(2, 10, 0), "pdm-c1", 4)

	before := pdmRead(t, f, otMelati, wtKaosHitam, wtA)

	f.take(t, pdmAt(1, 10, 0), "pdm-c2", 6)
	f.release(t, 1, "pdm-c1")

	after := pdmRead(t, f, otMelati, wtKaosHitam, wtA)

	pdmCheck(t, "after the cancel", after, 0, map[int]pdmWant{
		5: {in: 10, onHand: 10, kinds: "restock+10"},
		2: {out: 4, onHand: 6, kinds: "order-4"},
		1: {out: 2, onHand: 4, kinds: "order-2"},
		0: {onHand: 4},
	})

	for i := 2; i < 14; i++ {
		if pdmKinds(before[i]) != pdmKinds(after[i]) || before[i].GetOnHand() != after[i].GetOnHand() {
			t.Fatalf("%d days ago changed: %v → %v", i, before[i], after[i])
		}
	}

	// A cancel alone on its day — nothing else of the kind moved — is that day's net: +4 of order, Masuk.
	f.take(t, pdmAt(0, 8, 0), "pdm-c3", 3)
	f.release(t, 0, "pdm-c2")

	today := pdmRead(t, f, otMelati, wtKaosHitam, wtA)[0]
	if today.GetInUnits() != 3 || today.GetOutUnits() != 0 || pdmKinds(today) != "order+3" || today.GetOnHand() != 7 {
		t.Fatalf("today = Masuk %d Keluar %d [%s] Sisa %d — want a put-back of 6 net of a take of 3: Masuk 3, Sisa 7",
			today.GetInUnits(), today.GetOutUnits(), pdmKinds(today), today.GetOnHand())
	}
}

// ANOTHER SELLING TEAM reads the owner's days, the same figures (stock-history-is-everyones) — and the answer has no
// money in it at all: no value or price field on a day or a kind, for anybody (DiscoverStockHistory's policy).
func TestProductDailyMoves_AnotherTeamReadsTheSameUnitsAndNoValue(t *testing.T) {
	f := pdmStocked(t)

	for _, warehouse := range []uint64{0, wtA, wtB} {
		own := pdmRead(t, f, otMelati, wtKaosHitam, warehouse)
		theirs := pdmRead(t, f, otSinar, wtKaosHitam, warehouse)

		for i := range own {
			ownJSON, _ := protojson.Marshal(own[i])
			theirJSON, _ := protojson.Marshal(theirs[i])

			if string(ownJSON) != string(theirJSON) {
				t.Fatalf("warehouse %d, %d days ago: Sinar reads %s, the owner %s", warehouse, i, theirJSON, ownJSON)
			}
		}
	}

	for _, name := range []protoreflect.FullName{"warehouse.inventory.v1.ProductDailyMove", "warehouse.inventory.v1.ProductDailyMoveKind"} {
		desc, err := protoregistry.GlobalFiles.FindDescriptorByName(name)
		if err != nil {
			t.Fatalf("descriptor %s: %v", name, err)
		}

		fields := desc.(protoreflect.MessageDescriptor).Fields()
		for i := range fields.Len() {
			fd := fields.Get(i)
			if fd.Kind() == protoreflect.DoubleKind || fd.Kind() == protoreflect.FloatKind ||
				strings.Contains(string(fd.Name()), "value") || strings.Contains(string(fd.Name()), "price") {
				t.Fatalf("%s carries %s — a day of another team's product shows units only", name, fd.Name())
			}
		}
	}
}

// A PRODUCT NOBODY OWNS (unknown to product_service) reads fourteen empty days; a product with no movement in the window
// reads its stock on every day.
func TestProductDailyMoves_AnUnknownOrQuietProduct(t *testing.T) {
	f := pdmService(t)

	f.restock(t, 30, otMelati, wtA, f.rakA, wtKaosHitam, 7)

	pdmCheck(t, "unknown", pdmRead(t, f, otMelati, 899, 0), 0, nil)
	pdmCheck(t, "quiet", pdmRead(t, f, otMelati, wtKaosHitam, 0), 7, nil)
}

// Who may read — Discover's people (ProductSupplierGoods' policy): the selling side and root; a warehouse has no product
// page. A read, so the monitor and an agent's credential may call it (an-agent-only-reads-for-now).
func TestProductDailyMoves_TheSellingSideReads(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.ProductDailyMovesRequest")
	if err != nil {
		t.Fatalf("descriptor: %v", err)
	}

	roles := map[string]bool{}
	for _, role := range san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor)).GetRoles() {
		roles[role.String()] = true
	}

	for _, want := range []string{"ROLE_ROOT", "ROLE_ADMINISTRATOR", "ROLE_SELLING_OWNER", "ROLE_SELLING_ADMIN", "ROLE_SELLING_CS"} {
		if !roles[want] {
			t.Fatalf("%s may not read a product's days", want)
		}
	}

	for _, refused := range []string{"ROLE_WAREHOUSE_OWNER", "ROLE_WAREHOUSE_ADMIN", "ROLE_WAREHOUSE_STAFF"} {
		if roles[refused] {
			t.Fatalf("%s may read a product's days", refused)
		}
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.InventoryService.ProductDailyMoves")
	if err != nil {
		t.Fatalf("method: %v", err)
	}

	opts := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatalf("ProductDailyMoves is not marked a read")
	}
}
