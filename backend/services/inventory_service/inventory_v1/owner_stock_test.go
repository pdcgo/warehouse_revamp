package inventory_v1_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// acceptOwnedBy is acceptOne with the REQUESTING team spelled out — the whole point of the owner
// reads is that this id decides whose stock it is.
func acceptOwnedBy(
	t *testing.T,
	svc *inventory_v1.Service,
	owner, warehouse, rackID, product uint64,
	qty, total int64,
) {
	t.Helper()

	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: owner, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: product, ProductCode: "SKU", Name: "P", Count: qty, Total: float64(total)},
		},
	}))
	if err != nil {
		t.Fatalf("create restock: %v", err)
	}

	item := created.Msg.GetRequest().GetItems()[0]

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: created.Msg.GetRequest().GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId:        item.GetId(),
			ReceivedCount: qty,
			Placements: []*inventoryv1.RestockPlacement{
				{PlacementId: rackID, Quantity: qty},
			},
		}},
	}))
	if err != nil {
		t.Fatalf("fulfil restock: %v", err)
	}
}

func newRack(t *testing.T, svc *inventory_v1.Service, warehouse uint64, code string) uint64 {
	t.Helper()

	rack, err := svc.RackCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RackCreateRequest{
		TeamId: warehouse, Code: code,
	}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}

	return rack.Msg.GetRack().GetId()
}

func ownerStock(
	t *testing.T,
	svc *inventory_v1.Service,
	owner, warehouse uint64,
	productIDs []uint64,
) map[uint64]*inventoryv1.OwnerStockItem {
	t.Helper()

	res, err := svc.OwnerStockByIds(context.Background(), connect.NewRequest(&inventoryv1.OwnerStockByIdsRequest{
		TeamId: owner,
		Filter: &inventoryv1.OwnerStockByIdsFilter{ProductIds: productIDs, WarehouseId: warehouse},
	}))
	if err != nil {
		t.Fatalf("OwnerStockByIds: %v", err)
	}

	out := map[uint64]*inventoryv1.OwnerStockItem{}

	for id, list := range res.Msg.GetItems() {
		for _, it := range list.GetItems() {
			stock := it.GetStock()
			if stock == nil {
				continue
			}

			row, ok := stock.GetMapData()[id]
			if ok {
				out[id] = row
			}
		}
	}

	return out
}

// The whole row, off two deliveries at different prices: ready and its value, the cost SPREAD, the
// oldest batch still on a shelf, when stock last arrived, and a pending restock as ongoing.
func TestOwnerStockByIds_ReadyOngoingSpread(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const owner, warehouse, product uint64 = 2, 5, 100

	rack := newRack(t, svc, warehouse, "A-01-3")

	acceptOwnedBy(t, svc, owner, warehouse, rack, product, 100, 4_000_000) // 40.000/pc
	acceptOwnedBy(t, svc, owner, warehouse, rack, product, 50, 1_250_000)  // 25.000/pc

	// Inbound: raised, not yet accepted.
	_, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: owner, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: product, ProductCode: "SKU", Name: "P", Count: 30, Total: 900_000},
		},
	}))
	if err != nil {
		t.Fatalf("pending restock: %v", err)
	}

	row := ownerStock(t, svc, owner, 0, []uint64{product})[product]
	if row == nil {
		t.Fatalf("no row for the product the team owns")
	}

	if row.GetReadyQty() != 150 || row.GetReadyValue() != 5_250_000 {
		t.Fatalf("ready = %v/%v, want 150/5250000", row.GetReadyQty(), row.GetReadyValue())
	}
	if row.GetOngoingQty() != 30 || row.GetOngoingValueEst() != 900_000 {
		t.Fatalf("ongoing = %v/%v, want 30/900000", row.GetOngoingQty(), row.GetOngoingValueEst())
	}
	if !row.GetCostKnown() || row.GetCostMin() != 25_000 || row.GetCostMax() != 40_000 {
		t.Fatalf("cost spread = %v..%v (known=%v), want 25000..40000",
			row.GetCostMin(), row.GetCostMax(), row.GetCostKnown())
	}
	if row.GetOldestBatchUnix() == 0 {
		t.Fatalf("oldest batch unset while 150 units sit on a shelf")
	}
	if row.GetLastRestockUnix() < row.GetOldestBatchUnix() {
		t.Fatalf("last restock (%d) older than the oldest batch (%d)",
			row.GetLastRestockUnix(), row.GetOldestBatchUnix())
	}
}

// The ownership rule, which is the security property: stock is another team's unless it arrived on a
// restock THIS team raised. Passing somebody else's product id gets nothing, not their numbers.
func TestOwnerStockByIds_AnotherTeamsStockIsInvisible(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const mine, theirs, warehouse uint64 = 2, 3, 5
	const myProduct, theirProduct uint64 = 100, 200

	rack := newRack(t, svc, warehouse, "A-01-3")

	acceptOwnedBy(t, svc, mine, warehouse, rack, myProduct, 10, 100_000)
	acceptOwnedBy(t, svc, theirs, warehouse, rack, theirProduct, 999, 99_900_000)

	rows := ownerStock(t, svc, mine, 0, []uint64{myProduct, theirProduct})

	if rows[myProduct] == nil || rows[myProduct].GetReadyQty() != 10 {
		t.Fatalf("own product = %v, want 10 ready", rows[myProduct])
	}
	if rows[theirProduct] != nil {
		t.Fatalf("another team's stock leaked: %v", rows[theirProduct])
	}
}

// The warehouse LENS restates the figures as one building's, and the same call without it totals them.
func TestOwnerStockByIds_WarehouseLens(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const owner, jakarta, surabaya, product uint64 = 2, 5, 6, 100

	acceptOwnedBy(t, svc, owner, jakarta, newRack(t, svc, jakarta, "A-01-3"), product, 40, 1_600_000)
	acceptOwnedBy(t, svc, owner, surabaya, newRack(t, svc, surabaya, "B-02-1"), product, 60, 2_400_000)

	total := ownerStock(t, svc, owner, 0, []uint64{product})[product]
	if total.GetReadyQty() != 100 {
		t.Fatalf("total ready = %d, want 100", total.GetReadyQty())
	}

	one := ownerStock(t, svc, owner, jakarta, []uint64{product})[product]
	if one.GetReadyQty() != 40 || one.GetReadyValue() != 1_600_000 {
		t.Fatalf("jakarta ready = %v/%v, want 40/1600000", one.GetReadyQty(), one.GetReadyValue())
	}
}

// A product with nothing behind it is ABSENT rather than a row of zeros.
func TestOwnerStockByIds_NothingHeldIsAbsent(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rows := ownerStock(t, svc, 2, 0, []uint64{404})
	if len(rows) != 0 {
		t.Fatalf("rows = %v, want none", rows)
	}
}

// The stat totals the catalogue, follows the same ownership rule, and honours the lens.
func TestOwnerStockStat_TotalsAndLens(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const owner, theirs, jakarta, surabaya uint64 = 2, 3, 5, 6

	acceptOwnedBy(t, svc, owner, jakarta, newRack(t, svc, jakarta, "A-01-3"), 100, 40, 1_600_000)
	acceptOwnedBy(t, svc, owner, surabaya, newRack(t, svc, surabaya, "B-02-1"), 101, 60, 2_400_000)
	// Another team's goods in the same building — must not be counted.
	acceptOwnedBy(t, svc, theirs, jakarta, newRack(t, svc, jakarta, "A-02-1"), 300, 500, 50_000_000)

	_, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: owner, WarehouseId: jakarta,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, ProductCode: "SKU", Name: "P", Count: 25, Total: 1_000_000},
		},
	}))
	if err != nil {
		t.Fatalf("pending restock: %v", err)
	}

	all, err := svc.OwnerStockStat(context.Background(), connect.NewRequest(&inventoryv1.OwnerStockStatRequest{
		TeamId: owner,
	}))
	if err != nil {
		t.Fatalf("OwnerStockStat: %v", err)
	}

	preview := all.Msg.GetPreview()
	if preview.GetReadyQty() != 100 || preview.GetReadyValue() != 4_000_000 {
		t.Fatalf("ready = %v/%v, want 100/4000000", preview.GetReadyQty(), preview.GetReadyValue())
	}
	if preview.GetOngoingQty() != 25 || preview.GetOngoingValueEst() != 1_000_000 {
		t.Fatalf("ongoing = %v/%v, want 25/1000000", preview.GetOngoingQty(), preview.GetOngoingValueEst())
	}
	if preview.GetLastRestockUnix() == 0 {
		t.Fatalf("last restock unset after two accepted deliveries")
	}

	lensed, err := svc.OwnerStockStat(context.Background(), connect.NewRequest(&inventoryv1.OwnerStockStatRequest{
		TeamId: owner,
		Filter: &inventoryv1.OwnerStockStatFilter{WarehouseId: surabaya},
	}))
	if err != nil {
		t.Fatalf("OwnerStockStat(lens): %v", err)
	}

	if lensed.Msg.GetPreview().GetReadyQty() != 60 {
		t.Fatalf("surabaya ready = %d, want 60", lensed.Msg.GetPreview().GetReadyQty())
	}
	// The pending restock is destined for Jakarta, so Surabaya has nothing inbound.
	if lensed.Msg.GetPreview().GetOngoingQty() != 0 {
		t.Fatalf("surabaya ongoing = %d, want 0", lensed.Msg.GetPreview().GetOngoingQty())
	}
}

// ── IN TRANSIT (the-transfer-is-where-goods-in-transit-are) ─────────────────────────────────────────────────────────
//
// On the transfer fixture (Melati, Gudang 5 = A → Gudang 6 = B; at A Kaos Hitam 2 at 10.000 then 5 at 12.000, Kaos
// Polos 4 at 5.000; Kaos Merah is Sinar's). A transfer's units are in transit while its out-leg is written and no
// warehouse has booked them again: created, process, shipped, arrived and lost count; cancel and accepted do not.

// inTransitOf is one product's in transit as OwnerStockByIds answers it under the lens — 0 when the product is absent.
func inTransitOf(t *testing.T, svc *inventory_v1.Service, owner, lens, product uint64) (int64, float64) {
	t.Helper()

	row := ownerStock(t, svc, owner, lens, []uint64{product})[product]

	return row.GetInTransitQty(), row.GetInTransitValue()
}

// statInTransit is the team's in transit as OwnerStockStat answers it under the lens.
func statInTransit(t *testing.T, svc *inventory_v1.Service, owner, lens uint64) (int64, float64) {
	t.Helper()

	res, err := svc.OwnerStockStat(context.Background(), connect.NewRequest(&inventoryv1.OwnerStockStatRequest{
		TeamId: owner, Filter: &inventoryv1.OwnerStockStatFilter{WarehouseId: lens},
	}))
	if err != nil {
		t.Fatalf("OwnerStockStat: %v", err)
	}

	preview := res.Msg.GetPreview()

	return preview.GetInTransitQty(), preview.GetInTransitValue()
}

// metricInTransit is the Transfer metric's in transit at today's edge — the headline over the last week, or one row of
// a by-product / by-warehouse read when `id` is set.
func metricInTransit(
	t *testing.T,
	f *wtFixture,
	group analytic_basev1.GroupType,
	id uint64,
	filters ...*analytic_basev1.FilterItem,
) (int64, float64) {
	t.Helper()

	if len(filters) == 0 {
		filters = []*analytic_basev1.FilterItem{lastWeek()}
	}

	if group == analytic_basev1.GroupType_GROUP_TYPE_SUMMARY {
		got := mustRead(t, f.svc, transferSeller, otMelati, transferMetricID, group, nil, filters...).GetTransferSummary()

		return got.GetInTransitCount(), got.GetInTransitValue()
	}

	got := mustRead(t, f.svc, transferSeller, otMelati, transferMetricID, group, ids(id), filters...).
		GetTransferById().GetItems()[id]

	return got.GetInTransitCount(), got.GetInTransitValue()
}

func wantInTransit(t *testing.T, what string, qty int64, value float64, wantQty int64, wantValue float64) {
	t.Helper()

	if qty != wantQty || !san_money.Equal(value, wantValue) {
		t.Fatalf("%s in transit = %d (Rp %v), want %d (Rp %v)", what, qty, value, wantQty, wantValue)
	}
}

func (f *wtFixture) arrive(t *testing.T, id uint64) {
	t.Helper()

	_, err := f.svc.WarehouseTransferArrive(ctxUser(wtStaffB), connect.NewRequest(&inventoryv1.WarehouseTransferArriveRequest{
		TeamId: wtB, TransferId: id,
	}))
	if err != nil {
		t.Fatalf("arrive: %v", err)
	}
}

// Each status on its own: one transfer of Kaos Hitam 3 (2 × 10.000 + 1 × 12.000 = 32.000) taken to it, then the list
// row, the stat and the Transfer metric read the same in transit — and ready never carries it (in neither book).
func TestOwnerStockInTransit_EachStatusCountsOrNot(t *testing.T) {
	cases := []struct {
		name   string
		to     func(t *testing.T, f *wtFixture, tr *inventoryv1.WarehouseTransfer)
		counts bool
		ready  int64 // Kaos Hitam on a shelf afterwards, A and B together
	}{
		{"created", func(*testing.T, *wtFixture, *inventoryv1.WarehouseTransfer) {}, true, 4},
		{"process", func(t *testing.T, f *wtFixture, tr *inventoryv1.WarehouseTransfer) { f.process(t, tr.GetId()) }, true, 4},
		{"shipped", func(t *testing.T, f *wtFixture, tr *inventoryv1.WarehouseTransfer) { f.ship(t, tr.GetId()) }, true, 4},
		{"arrived", func(t *testing.T, f *wtFixture, tr *inventoryv1.WarehouseTransfer) {
			f.ship(t, tr.GetId())
			f.arrive(t, tr.GetId())
		}, true, 4},
		{"lost — the box stays in transit", func(t *testing.T, f *wtFixture, tr *inventoryv1.WarehouseTransfer) {
			f.ship(t, tr.GetId())

			_, err := markTransferLost(f, otMelati, tr.GetId())
			if err != nil {
				t.Fatalf("mark lost: %v", err)
			}
		}, true, 4},
		{"cancel — the out-leg rolled back", func(t *testing.T, f *wtFixture, tr *inventoryv1.WarehouseTransfer) {
			_, err := f.svc.WarehouseTransferCancel(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.WarehouseTransferCancelRequest{
				TeamId: otMelati, TransferId: tr.GetId(),
			}))
			if err != nil {
				t.Fatalf("cancel: %v", err)
			}
		}, false, 7},
		{"accepted — booked at B", func(t *testing.T, f *wtFixture, tr *inventoryv1.WarehouseTransfer) {
			f.ship(t, tr.GetId())

			_, err := f.accept(tr.GetId(), 0, "", counted(itemOf(t, tr, wtKaosHitam), 3, 0, f.rakB1))
			if err != nil {
				t.Fatalf("accept: %v", err)
			}
		}, false, 7},
		{"accepted with nothing good — broken at the door", func(t *testing.T, f *wtFixture, tr *inventoryv1.WarehouseTransfer) {
			f.ship(t, tr.GetId())

			_, err := f.accept(tr.GetId(), 0, "", counted(itemOf(t, tr, wtKaosHitam), 3, 3, f.rakB1))
			if err != nil {
				t.Fatalf("accept: %v", err)
			}
		}, false, 4},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := wtStocked(t)
			tr := f.create(t, wtLine(wtKaosHitam, 3))
			c.to(t, f, tr)

			var wantQty int64
			var wantValue float64

			if c.counts {
				wantQty, wantValue = 3, 32_000
			}

			qty, value := inTransitOf(t, f.svc, otMelati, 0, wtKaosHitam)
			wantInTransit(t, "the list row", qty, value, wantQty, wantValue)

			qty, value = statInTransit(t, f.svc, otMelati, 0)
			wantInTransit(t, "the stat", qty, value, wantQty, wantValue)

			qty, value = metricInTransit(t, f, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, 0)
			wantInTransit(t, "the Transfer metric", qty, value, wantQty, wantValue)

			row := ownerStock(t, f.svc, otMelati, 0, []uint64{wtKaosHitam})[wtKaosHitam]
			if row.GetReadyQty() != c.ready {
				t.Fatalf("ready = %d, want %d — in transit is never on a shelf", row.GetReadyQty(), c.ready)
			}
		})
	}
}

// The warehouse lens reads a transfer under its RECEIVING warehouse only (the Transfer metric's rule): B sees what is on
// the road to it; A, whose book already shows the units gone, sees none; another building sees none.
func TestOwnerStockInTransit_CountsUnderTheReceiver(t *testing.T) {
	f := wtStocked(t)
	tr := f.create(t, wtLine(wtKaosHitam, 3))
	f.ship(t, tr.GetId())

	for _, c := range []struct {
		name  string
		lens  uint64
		qty   int64
		value float64
	}{
		{"every warehouse", 0, 3, 32_000},
		{"B, the receiver", wtB, 3, 32_000},
		{"A, the sender", wtA, 0, 0},
		{"a building it never touched", wtOther, 0, 0},
	} {
		qty, value := inTransitOf(t, f.svc, otMelati, c.lens, wtKaosHitam)
		wantInTransit(t, c.name+": the list row", qty, value, c.qty, c.value)

		qty, value = statInTransit(t, f.svc, otMelati, c.lens)
		wantInTransit(t, c.name+": the stat", qty, value, c.qty, c.value)
	}

	// A product only on the road to B is a row under B's lens — something to say, not absent.
	row := ownerStock(t, f.svc, otMelati, wtB, []uint64{wtKaosHitam})[wtKaosHitam]
	if row == nil || row.GetReadyQty() != 0 {
		t.Fatalf("B's row = %v — want a row with nothing ready and 3 in transit", row)
	}

	if a := ownerStock(t, f.svc, otMelati, wtA, []uint64{wtKaosHitam})[wtKaosHitam]; a.GetReadyQty() != 4 {
		t.Fatalf("A ready = %d, want 4 — the 3 left A's book at create", a.GetReadyQty())
	}
}

// Ownership: another team's transfer never reaches this team's figures — nor this team's theirs.
func TestOwnerStockInTransit_AnotherTeamsTransferIsInvisible(t *testing.T) {
	f := wtStocked(t)

	_, err := f.svc.WarehouseTransferCreate(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
		TeamId: otSinar, FromWarehouseId: wtA, ToWarehouseId: wtB, Lines: []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosMerah, 2)},
	}))
	if err != nil {
		t.Fatalf("Sinar's transfer: %v", err)
	}

	rows := ownerStock(t, f.svc, otMelati, 0, []uint64{wtKaosMerah, wtKaosHitam})
	if rows[wtKaosMerah] != nil {
		t.Fatalf("Sinar's product reached Melati: %v", rows[wtKaosMerah])
	}

	wantInTransit(t, "Melati's Kaos Hitam", rows[wtKaosHitam].GetInTransitQty(), rows[wtKaosHitam].GetInTransitValue(), 0, 0)

	qty, value := statInTransit(t, f.svc, otMelati, 0)
	wantInTransit(t, "Melati's stat", qty, value, 0, 0)

	qty, value = inTransitOf(t, f.svc, otSinar, wtB, wtKaosMerah)
	wantInTransit(t, "Sinar's own Kaos Merah", qty, value, 2, 20_000)

	qty, value = statInTransit(t, f.svc, otSinar, 0)
	wantInTransit(t, "Sinar's stat", qty, value, 2, 20_000)
}

// One product on two open transfers adds up, and a transfer of two products counts each under its own row.
func TestOwnerStockInTransit_TwoOpenTransfersOfOneProductAddUp(t *testing.T) {
	f := wtStocked(t)

	f.create(t, wtLine(wtKaosHitam, 3))                               // 2 × 10.000 + 1 × 12.000 = 32.000
	t2 := f.create(t, wtLine(wtKaosHitam, 2), wtLine(wtKaosPolos, 2)) // 2 × 12.000 = 24.000 · 2 × 5.000 = 10.000
	f.ship(t, t2.GetId())

	rows := ownerStock(t, f.svc, otMelati, 0, []uint64{wtKaosHitam, wtKaosPolos})
	wantInTransit(t, "Kaos Hitam", rows[wtKaosHitam].GetInTransitQty(), rows[wtKaosHitam].GetInTransitValue(), 5, 56_000)
	wantInTransit(t, "Kaos Polos", rows[wtKaosPolos].GetInTransitQty(), rows[wtKaosPolos].GetInTransitValue(), 2, 10_000)

	qty, value := statInTransit(t, f.svc, otMelati, 0)
	wantInTransit(t, "the stat", qty, value, 7, 66_000)
}

// The page's in transit is ONE statement whatever the page's size — never one per product (no N+1) — and the
// whole call stays four statements.
func TestOwnerStockByIds_InTransitIsOneStatementPerPage(t *testing.T) {
	f := wtStocked(t)

	f.create(t, wtLine(wtKaosHitam, 3))
	f.create(t, wtLine(wtKaosPolos, 2))

	db, probe := san_perf.Wrap(f.db)
	svc := inventory_v1.NewService(db, nil, nil, nil, f.sent.send, wtFacts(), nil, nil)

	page := []uint64{wtKaosHitam, wtKaosPolos}
	for id := uint64(10_000); len(page) < 200; id++ {
		page = append(page, id)
	}

	for _, ids := range [][]uint64{{wtKaosHitam}, {wtKaosHitam, wtKaosPolos}, page} {
		probe.Reset()

		rows := ownerStock(t, svc, otMelati, 0, ids)

		transit := 0
		for _, q := range probe.Queries() {
			if strings.Contains(q.SQL, "warehouse_transfer_items") {
				transit++
			}
		}

		if transit != 1 || probe.Count() != 4 {
			t.Fatalf("a page of %d: %d in-transit statements of %d — want 1 of 4", len(ids), transit, probe.Count())
		}

		wantInTransit(t, "Kaos Hitam", rows[wtKaosHitam].GetInTransitQty(), rows[wtKaosHitam].GetInTransitValue(), 3, 32_000)
	}
}

// The list row, the stat and the Transfer metric's in transit for the same day agree — in total, per product, and per
// warehouse under the receiver — over every kind of transfer at once: the metric's own book (one accepted with a unit
// missing, one cancelled, one created today) plus one lost, one arrived, and one on its way back from B to A.
func TestOwnerStockInTransit_AgreesWithTheTransferMetric(t *testing.T) {
	f := transferBook(t)

	lost := f.create(t, wtLine(wtKaosHitam, 1))
	f.ship(t, lost.GetId())

	_, err := markTransferLost(f, otMelati, lost.GetId())
	if err != nil {
		t.Fatalf("mark lost: %v", err)
	}

	arrived := f.create(t, wtLine(wtKaosPolos, 2))
	f.ship(t, arrived.GetId())
	f.arrive(t, arrived.GetId())

	// One of T1's two good units goes back: on the road to A.
	_, err = f.svc.WarehouseTransferCreate(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
		TeamId: otMelati, FromWarehouseId: wtB, ToWarehouseId: wtA, Lines: []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosHitam, 1)},
	}))
	if err != nil {
		t.Fatalf("B → A: %v", err)
	}

	summary := analytic_basev1.GroupType_GROUP_TYPE_SUMMARY
	byProduct := analytic_basev1.GroupType_GROUP_TYPE_PRODUCT
	byWarehouse := analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE

	// Every warehouse: T3 + lost + back (Kaos Hitam 3), arrived (Kaos Polos 2).
	mQty, mValue := metricInTransit(t, f, summary, 0)
	if mQty != 5 {
		t.Fatalf("the metric's in transit = %d, want 5 — the fixture moved", mQty)
	}

	qty, value := statInTransit(t, f.svc, otMelati, 0)
	wantInTransit(t, "the stat vs the metric", qty, value, mQty, mValue)

	for _, product := range []uint64{wtKaosHitam, wtKaosPolos} {
		mQty, mValue = metricInTransit(t, f, byProduct, product)
		qty, value = inTransitOf(t, f.svc, otMelati, 0, product)
		wantInTransit(t, "product "+itoa(product)+" vs the metric", qty, value, mQty, mValue)
	}

	// Under each warehouse: the metric's by-warehouse row and its warehouse filter, against the lens.
	for _, c := range []struct {
		warehouse uint64
		qty       int64
	}{{wtA, 1}, {wtB, 4}} {
		name := "warehouse " + itoa(c.warehouse)

		mQty, mValue = metricInTransit(t, f, byWarehouse, c.warehouse)
		if mQty != c.qty {
			t.Fatalf("%s: the metric's in transit = %d, want %d", name, mQty, c.qty)
		}

		qty, value = statInTransit(t, f.svc, otMelati, c.warehouse)
		wantInTransit(t, name+": the stat vs the metric", qty, value, mQty, mValue)

		for _, product := range []uint64{wtKaosHitam, wtKaosPolos} {
			mQty, mValue = metricInTransit(t, f, byProduct, product, lastWeek(), warehouseFilter(c.warehouse))
			qty, value = inTransitOf(t, f.svc, otMelati, c.warehouse, product)
			wantInTransit(t, name+": product "+itoa(product)+" vs the metric", qty, value, mQty, mValue)
		}
	}
}
