package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A WAREHOUSE PRODUCT'S STOCK HISTORY NAMES EACH MOVEMENT'S BATCH (backlog #142 — docs/acceptances/inventory/
// transaction.md given 1, *"each with its units, the stock after, who did it, its batch and its rack"*, Errors entry
// the-stock-history-names-no-batch: the Batch column read "—" on every row). The read WITHOUT a batch stays the rack
// rows — the units, the rack's count after, who and the rack exactly as before — and each now names the batch its units
// came from: the batch rows its transaction wrote for the product on the same side. A move writes no batch row
// (a-move-writes-two-rack-rows-and-no-batch-row): it names the warehouse's only batch of the product up to the move.
func TestStockHistory_AProductsRowsNameTheirBatch(t *testing.T) {
	svc, db, rakA, rakB := otStocked(t)
	b1 := hitamBatch(t, db).ID

	// Given 1's ground: 10 received onto Rak A, 2 picked for an order, 5 moved from Rak A to Rak B, 1 sample off Rak B.
	_, err := take(svc, "key-142-pick", line(otKaosHitam, 2))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	moveHitam(t, svc, rakA, rakB, 5)

	_, err = svc.RackSample(ctxUser(8), connect.NewRequest(&inventoryv1.RackSampleRequest{
		TeamId: otWarehouse, RackId: rakB, Recipient: "Pak Budi",
		Lines: []*inventoryv1.RackSampleLine{{ProductId: otKaosHitam, Quantity: 1}},
	}))
	if err != nil {
		t.Fatalf("sample: %v", err)
	}

	wantHistory(t, "given 1", productHistoryOf(t, svc, otKaosHitam, inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED),
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_SAMPLE, rakB, b1, -1, 4},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_MOVE, rakB, b1, 5, 5},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_MOVE, rakA, b1, -5, 3},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_PICK, rakA, b1, -2, 8},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE, rakA, b1, 10, 10},
	)

	// A rack's own history is unchanged: the rack rows, no batch (RackHistory never reads one).
	for _, m := range rackHistoryOf(t, svc, rakB) {
		if m.GetBatchId() != 0 {
			t.Fatalf("Rak B's history names batch %d: %+v — a rack's history was not asked to", m.GetBatchId(), m)
		}
	}

	// A second delivery, onto Rak A: from now on the warehouse holds two batches of Kaos Hitam, so a move cannot say
	// whose units it carried — 0, said as "—". The earlier moves keep b1: only b1 had been minted when they were made.
	otRestock(t, svc, otMelati, otKaosHitam, 5, 75000, []*inventoryv1.RestockPlacement{{PlacementId: rakA, Quantity: 5}})
	b2 := newestHitamBatch(t, db)

	moveHitam(t, svc, rakA, rakB, 1)

	got := productHistoryOf(t, svc, otKaosHitam, inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED)
	wantHistory(t, "a move after a second batch", got,
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_MOVE, rakB, 0, 1, 5},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_MOVE, rakA, 0, -1, 7},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE, rakA, b2, 5, 8},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_SAMPLE, rakB, b1, -1, 4},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_MOVE, rakB, b1, 5, 5},
	)

	// A take of 9: Rak B holds the fewest (5) and goes first, then 4 off Rak A; b1 gives its 7 left, then b2 2. Two racks
	// drawn by two batches — which rack fed which batch is not recorded: each rack row whole, batch 0.
	_, err = take(svc, "key-142-both", line(otKaosHitam, 9))
	if err != nil {
		t.Fatalf("take of 9: %v", err)
	}

	got = productHistoryOf(t, svc, otKaosHitam, inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED)
	if len(got) < 2 || got[0].GetBatchId() != 0 || got[1].GetBatchId() != 0 || got[0].GetDelta()+got[1].GetDelta() != -9 {
		t.Fatalf("the take of 9 over two racks and two batches = %+v, want two whole rack rows with no batch", got[:2])
	}
}

// A MOVEMENT THAT DREW FROM SEVERAL BATCHES OFF ONE RACK reads one row per batch — as a batch's history splits a
// movement over two racks (batchRackJoin): each part its batch's units and the rack's count after it, newest first,
// every id once, the parts counted in the total. Its cancel puts each batch's units back the same way.
func TestStockHistory_AProductsRowSplitsOverItsBatches(t *testing.T) {
	svc, db, rakA, _ := otStocked(t)
	b1 := hitamBatch(t, db).ID

	otRestock(t, svc, otMelati, otKaosHitam, 5, 75000, []*inventoryv1.RestockPlacement{{PlacementId: rakA, Quantity: 5}})
	b2 := newestHitamBatch(t, db)

	// Rak A holds 15 — b1's 10 and b2's 5 — and is the only rack: a take of 12 is ONE rack row, b1 10 then b2 2.
	_, err := take(svc, "key-142-split", line(otKaosHitam, 12))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	got := productHistoryOf(t, svc, otKaosHitam, inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED)
	wantHistory(t, "the take split over its batches", got,
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_PICK, rakA, b2, -2, 3},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_PICK, rakA, b1, -10, 5},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE, rakA, b2, 5, 15},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE, rakA, b1, 10, 10},
	)

	// The order is cancelled: the take's rows reversed under its transaction — a CANCEL (#143), each batch's units back.
	_, err = release(svc, otMelati, "key-142-split")
	if err != nil {
		t.Fatalf("release: %v", err)
	}

	got = productHistoryOf(t, svc, otKaosHitam, inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED)
	wantHistory(t, "the cancel split over its batches", got,
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_CANCEL, rakA, b2, 2, 15},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_CANCEL, rakA, b1, 10, 13},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_PICK, rakA, b2, -2, 3},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_PICK, rakA, b1, -10, 5},
	)

	// The parts page and count as rows: six in all, no id twice across pages of one.
	seen := map[uint64]bool{}

	for p := uint32(1); p <= 7; p++ {
		res, hErr := svc.StockHistory(context.Background(), connect.NewRequest(&inventoryv1.StockHistoryRequest{
			WarehouseId: otWarehouse,
			Filter:      &inventoryv1.StockHistoryFilter{ProductId: otKaosHitam},
			Page:        &commonv1.CommonPagination{Page: p, Limit: 1},
		}))
		if hErr != nil {
			t.Fatalf("page %d: %v", p, hErr)
		}

		if total := res.Msg.GetPageInfo().GetTotalItems(); total != 6 {
			t.Fatalf("total = %d, want 6 — the two receives, and the take and its cancel in two parts each", total)
		}

		for _, m := range stockHistoryRows(res.Msg) {
			if seen[m.GetId()] {
				t.Fatalf("id %d repeats across pages", m.GetId())
			}

			seen[m.GetId()] = true
		}
	}

	if len(seen) != 6 {
		t.Fatalf("paged %d rows, want 6", len(seen))
	}
}

// EVERY KIND BY ITS OWN WORD (#143 — transaction.md given 2: *"the cancelled order's units shown coming back, as a
// cancel"*; given 3: *"the damaged unit shown as broken"*, *"the found unit shown as found"*; given 4: *"… price
// corrected"*). A cancel, a broken unit and a found unit each read as their own kind — on the product's history and on a
// rack's alike (kindOf is the one place) — and a price correction, which writes no rack row, is on the product's
// history with its price before and after, on no rack. The kinds they were split from keep their filter's reach.
func TestStockHistory_AProductsKindsAreEachTheirOwn(t *testing.T) {
	f := opnameStocked(t)

	// Melati's Kaos Hitam: batch 1 — 8 at Rp 10.000 (Rak A 5, Rak B 3) — and batch 2 — 2 at Rp 12.000 (Rak B 2).
	batches := productBatches(t, f.db, otKaosHitam)
	b1, b2 := batches[0].ID, batches[1].ID

	// An order takes 1 (Rak A, the fewest… tie to the smaller id; b1, the oldest) and is cancelled.
	_, err := takeAs(f.svc, otMelati, "key-143-cancel", line(otKaosHitam, 1))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	_, err = release(f.svc, otMelati, "key-143-cancel")
	if err != nil {
		t.Fatalf("release: %v", err)
	}

	// 1 of b2 found damaged on Rak B (Stock Adjust, by the admin), then 1 found on Rak A, reported and approved.
	_, err = f.svc.StockAdjust(opAdmin(opBudi), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: otWarehouse, ProductId: otKaosHitam,
		Place:      &inventoryv1.StockAdjustRequest_RackId{RackId: f.rakB},
		ReasonType: inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_DAMAGED,
		BatchId:    b2, Quantity: 1, Reason: "kardus basah",
	}))
	if err != nil {
		t.Fatalf("damaged: %v", err)
	}

	found := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakA, 1)

	_, err = f.approve(opOwner(opDewi), found.GetId())
	if err != nil {
		t.Fatalf("approve the found: %v", err)
	}

	// The owning team corrects b1's price: 8 left, Rp 10.000 → Rp 11.000.
	_, err = f.svc.BatchRevalue(ctxAs(8, otMelati, sellerRole), connect.NewRequest(revalueRequest(b1, 10000, 11000)))
	if err != nil {
		t.Fatalf("revalue: %v", err)
	}

	foundBatch := batchOfNewest(t, f.db, "found")

	got := productHistoryOf(t, f.svc, otKaosHitam, inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED)
	wantHistory(t, "the kinds", got,
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_REVALUATION, 0, b1, 0, 8},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_FOUND, f.rakA, foundBatch, 1, 6},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_BROKEN, f.rakB, b2, -1, 4},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_CANCEL, f.rakA, b1, 1, 5},
		hrow{inventoryv1.MovementKind_MOVEMENT_KIND_PICK, f.rakA, b1, -1, 4},
	)

	price := got[0]
	if !san_money.Equal(price.GetPriceUnitBefore(), 10000) || !san_money.Equal(price.GetPriceUnitAfter(), 11000) ||
		!san_money.Equal(price.GetValueChange(), 8000) || price.GetReason() != revalueReason || price.GetActorUserId() != 8 {
		t.Fatalf("the price correction = %+v, want 10000 → 11000, +8000, its reason and who", price)
	}

	for _, m := range got[1:] {
		if m.GetPriceUnitBefore() != 0 || m.GetPriceUnitAfter() != 0 || m.GetValueChange() != 0 {
			t.Fatalf("a rack row carries a price: %+v — only a price correction says one", m)
		}
	}

	// Each new kind finds its own rows; the price correction answers no kind but its own.
	for kind, want := range map[inventoryv1.MovementKind]int{
		inventoryv1.MovementKind_MOVEMENT_KIND_CANCEL:      1,
		inventoryv1.MovementKind_MOVEMENT_KIND_BROKEN:      1,
		inventoryv1.MovementKind_MOVEMENT_KIND_FOUND:       1,
		inventoryv1.MovementKind_MOVEMENT_KIND_REVALUATION: 1,
		inventoryv1.MovementKind_MOVEMENT_KIND_MOVE:        0,
	} {
		rows := productHistoryOf(t, f.svc, otKaosHitam, kind)
		if len(rows) != want {
			t.Fatalf("%v filter = %d rows, want %d: %+v", kind, len(rows), want, rows)
		}

		for _, m := range rows {
			if m.GetKind() != kind {
				t.Fatalf("%v filter answered a %v row", kind, m.GetKind())
			}
		}
	}

	// The kinds they were split from keep their reach: ADJUST still finds the broken and the found (the warehouse
	// product page's last stock-take reads it), RETURN still finds the cancel.
	if rows := productHistoryOf(t, f.svc, otKaosHitam, inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST); len(rows) != 2 {
		t.Fatalf("ADJUST filter = %d rows, want the broken and the found", len(rows))
	}

	if rows := productHistoryOf(t, f.svc, otKaosHitam, inventoryv1.MovementKind_MOVEMENT_KIND_RETURN); len(rows) != 1 ||
		rows[0].GetKind() != inventoryv1.MovementKind_MOVEMENT_KIND_CANCEL {
		t.Fatalf("RETURN filter = %+v, want the cancel", rows)
	}

	// A rack's history names the same kinds (kindOf is one place) and never a price correction.
	kinds := map[inventoryv1.MovementKind]bool{}
	for _, m := range rackHistoryOf(t, f.svc, f.rakA) {
		kinds[m.GetKind()] = true
	}

	for _, m := range rackHistoryOf(t, f.svc, f.rakB) {
		kinds[m.GetKind()] = true
	}

	if !kinds[inventoryv1.MovementKind_MOVEMENT_KIND_CANCEL] || !kinds[inventoryv1.MovementKind_MOVEMENT_KIND_BROKEN] ||
		!kinds[inventoryv1.MovementKind_MOVEMENT_KIND_FOUND] || kinds[inventoryv1.MovementKind_MOVEMENT_KIND_RETURN] ||
		kinds[inventoryv1.MovementKind_MOVEMENT_KIND_REVALUATION] {
		t.Fatalf("the racks' kinds = %v, want CANCEL, BROKEN and FOUND, no RETURN and no price correction", kinds)
	}
}

type hrow struct {
	kind    inventoryv1.MovementKind
	rack    uint64
	batch   uint64
	delta   int64
	balance int64
}

// wantHistory checks the newest rows of a product's history: kind, rack, batch, units and count after, every id once.
func wantHistory(t *testing.T, what string, got []*inventoryv1.StockMovement, want ...hrow) {
	t.Helper()

	if len(got) < len(want) {
		t.Fatalf("%s: %d rows, want at least %d: %+v", what, len(got), len(want), got)
	}

	seen := map[uint64]bool{}

	for i, w := range want {
		g := got[i]
		if g.GetKind() != w.kind || g.GetRackId() != w.rack || g.GetBatchId() != w.batch || g.GetDelta() != w.delta ||
			g.GetBalance() != w.balance || seen[g.GetId()] {
			t.Fatalf("%s: row %d = kind %v rack %d batch %d delta %d after %d id %d — want %+v\n(rows %+v)",
				what, i, g.GetKind(), g.GetRackId(), g.GetBatchId(), g.GetDelta(), g.GetBalance(), g.GetId(), w, got)
		}

		seen[g.GetId()] = true
	}
}

// productHistoryOf is the product's StockHistory in Gudang 5 WITHOUT a batch — the warehouse product page's read.
func productHistoryOf(t *testing.T, svc *inventory_v1.Service, product uint64, kind inventoryv1.MovementKind) []*inventoryv1.StockMovement {
	t.Helper()

	res, err := svc.StockHistory(context.Background(), connect.NewRequest(&inventoryv1.StockHistoryRequest{
		WarehouseId: otWarehouse,
		Filter:      &inventoryv1.StockHistoryFilter{ProductId: product, Kind: kind},
		Page:        page1(),
	}))
	if err != nil {
		t.Fatalf("StockHistory: %v", err)
	}

	if uint64(len(res.Msg.GetIds())) != res.Msg.GetPageInfo().GetTotalItems() {
		t.Fatalf("a page of %d ids for a total of %d", len(res.Msg.GetIds()), res.Msg.GetPageInfo().GetTotalItems())
	}

	return stockHistoryRows(res.Msg)
}

func rackHistoryOf(t *testing.T, svc *inventory_v1.Service, rack uint64) []*inventoryv1.StockMovement {
	t.Helper()

	res, err := svc.RackHistory(ctxUser(1), connect.NewRequest(&inventoryv1.RackHistoryRequest{
		TeamId: otWarehouse, Filter: &inventoryv1.RackHistoryFilter{RackId: rack}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackHistory: %v", err)
	}

	return rackHistoryRows(res.Msg)
}

func moveHitam(t *testing.T, svc *inventory_v1.Service, from, to uint64, n int64) {
	t.Helper()

	_, err := svc.RackMove(ctxUser(8), connect.NewRequest(&inventoryv1.RackMoveRequest{
		TeamId: otWarehouse, FromRackId: from, Lines: []*inventoryv1.RackMoveLine{{ProductId: otKaosHitam, Quantity: n, ToRackId: to}},
	}))
	if err != nil {
		t.Fatalf("move %d: %v", n, err)
	}
}

func newestHitamBatch(t *testing.T, db *gorm.DB) uint64 {
	t.Helper()

	batches := productBatches(t, db, otKaosHitam)

	return batches[len(batches)-1].ID
}

// batchOfNewest is the batch the newest batch row of a change type names.
func batchOfNewest(t *testing.T, db *gorm.DB, changeType string) uint64 {
	t.Helper()

	var id uint64

	err := db.Raw(`SELECT batch_id FROM batch_logs WHERE change_type = ? ORDER BY id DESC LIMIT 1`, changeType).Scan(&id).Error
	if err != nil || id == 0 {
		t.Fatalf("the newest %s batch row: %v (batch %d)", changeType, err, id)
	}

	return id
}
