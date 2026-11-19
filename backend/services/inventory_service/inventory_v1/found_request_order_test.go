package inventory_v1_test

import (
	"context"
	"strings"
	"sync"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A FOUND FROM A LOST ORDER NAMES THE ORDER (a-found-lost-parcel-is-a-found-stock-in): Melati's order 9301 took 9 Kaos
// Hitam from Gudang 5 — batch 1's 8 at Rp 10.000 and one of batch 2's at Rp 12.000 — shipped, and went `lost`. The parcel
// turns up at Gudang 5: reported as a found NAMING THE ORDER, approved, the units come back under Melati at the cost the
// order took them at, one batch per batch the take drew from. The order stays lost; its timeline names the request.

const (
	lostOrderID uint64 = 9301
)

// lostOrders is selling_service for these tests: the orders the fixture sets, and every note it was asked to write. It
// moves no status — it has no way to: the seam only reads an order and writes a note.
type lostOrders struct {
	mu     sync.Mutex
	orders map[uint64]inventory_v1.FoundOrder
	notes  []inventory_v1.FoundNote
	asked  int
}

func (l *lostOrders) OrderIDsByReturnTransactions(context.Context, []uint64) (map[uint64]uint64, error) {
	return map[uint64]uint64{}, nil
}

func (l *lostOrders) FoundOrder(_ context.Context, id uint64) (inventory_v1.FoundOrder, bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.asked++
	o, ok := l.orders[id]

	return o, ok, nil
}

func (l *lostOrders) NoteFound(_ context.Context, _ *gorm.DB, n inventory_v1.FoundNote) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.notes = append(l.notes, n)

	return nil
}

type lostOrderFixture struct {
	*opnameFixture
	orders *lostOrders
	// The lost order's take.
	take uint64
}

// lostOrderStocked is the stock count's Gudang 5 after Melati's order 9301 took 9 Kaos Hitam and was lost: one Kaos
// Hitam is left, batch 2's, on Rak B.
func lostOrderStocked(t *testing.T) *lostOrderFixture {
	t.Helper()

	f := opnameStocked(t)
	orders := &lostOrders{orders: map[uint64]inventory_v1.FoundOrder{}}
	f.svc = inventory_v1.NewService(f.db, f.poster, f.expense, nil, nil, opFacts(), nil, nil, orders, nil)

	res, err := orderKaosHitam(f, "key-lost-9301", 9)
	if err != nil {
		t.Fatalf("the order's take: %v", err)
	}

	take := res.Msg.GetTransactionId()
	orders.orders[lostOrderID] = inventory_v1.FoundOrder{
		ID: lostOrderID, TeamID: otMelati, WarehouseID: otWarehouse, Status: "lost", Lost: true, TakeTransactionID: take,
	}

	f.poster.damaged = nil
	f.expense.posted = nil

	return &lostOrderFixture{opnameFixture: f, orders: orders, take: take}
}

// reportFrom sends a found naming an order through FoundRequestCreate.
func (f *lostOrderFixture) reportFrom(
	ctx context.Context,
	order, product, rack uint64,
	n int64,
) (*inventoryv1.FoundRequest, error) {
	res, err := f.svc.FoundRequestCreate(ctx, connect.NewRequest(&inventoryv1.FoundRequestCreateRequest{
		TeamId: otWarehouse, ProductId: product, RackId: rack, Quantity: n, Note: "the courier brought it back",
		OrderId: order,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetFoundRequest(), nil
}

func (f *lostOrderFixture) mustReportFrom(t *testing.T, order, product, rack uint64, n int64) *inventoryv1.FoundRequest {
	t.Helper()

	r, err := f.reportFrom(opStaff(opAni), order, product, rack, n)
	if err != nil {
		t.Fatalf("report %d of product %d from order %d: %v", n, product, order, err)
	}

	return r
}

type mintLine struct {
	n     int64
	price float64
}

// orderMints fails unless the lines are exactly the order mints wanted, in order — each priced, none a claim.
func orderMints(t *testing.T, what string, lines []*inventoryv1.FoundRequestPostLine, minted bool, want ...mintLine) {
	t.Helper()

	if len(lines) != len(want) {
		t.Fatalf("%s: %d lines %v, want %d", what, len(lines), lines, len(want))
	}

	for i, l := range lines {
		if l.GetType() != inventoryv1.FoundRequestPostType_FOUND_REQUEST_POST_TYPE_ORDER_MINT || l.GetStockCount() != want[i].n ||
			!san_money.Equal(l.GetPriceUnit(), want[i].price) ||
			!san_money.Equal(l.GetAmount(), float64(want[i].n)*want[i].price) || l.GetProblemId() != 0 ||
			(l.GetBatchId() != 0) != minted {
			t.Fatalf("%s: line %d = %+v, want an order mint of %d at %v (minted %v)", what, i, l, want[i].n, want[i].price, minted)
		}
	}
}

// foundBatches is every batch a transaction minted, oldest first.
func foundBatches(t *testing.T, db *gorm.DB, txID uint64) []models.Batch {
	t.Helper()

	var out []models.Batch
	db.Where("transaction_id = ?", txID).Order("id").Find(&out)

	return out
}

// THE COST THE ORDER TOOK THEM AT, NOT THE NEWEST PRICE, AND NO LOSS CLAIMED. The last Kaos Hitam on the shelf (batch 2,
// Rak B) is first reported lost — an open loss a plain found would claim back. Ani reports the parcel's 9 found on
// Rak C naming order 9301: it names the order, would mint 8 at Rp 10.000 and 1 at Rp 12.000 (the take's two layers),
// claims nothing, and the order's timeline gets ONE note naming the request. Budi approves: two batches under Melati at
// those prices, Rak C holds 9, both ledgers agree, the open loss stays open and nothing is posted to liability.
func TestFoundRequestOrder_MintsAtTheCostTheOrderTookThemAt(t *testing.T) {
	f := lostOrderStocked(t)
	bs := batchesOf(t, f.opnameFixture, otKaosHitam)
	f.lostOne(t, bs[1], f.rakB, 1)
	f.poster.damaged = nil

	r := f.mustReportFrom(t, lostOrderID, otKaosHitam, f.rakC, 9)

	if r.GetOrderId() != lostOrderID || r.GetStatus() != inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_WAITING {
		t.Fatalf("reported %+v, want WAITING naming order %d", r, lostOrderID)
	}

	orderMints(t, "the preview", r.GetLines(), false, mintLine{8, 10000}, mintLine{1, 12000})

	if r.GetClaimedAmount() != 0 || !san_money.Equal(r.GetMintedAmount(), 92000) {
		t.Fatalf("claimed %v minted %v, want 0 and Rp 92.000", r.GetClaimedAmount(), r.GetMintedAmount())
	}

	row := foundRow(t, f.db, r.GetId())
	if row.OrderID == nil || *row.OrderID != lostOrderID || row.OrderTakeTransactionID == nil || *row.OrderTakeTransactionID != f.take {
		t.Fatalf("stored order %v take %v, want order %d and its take %d", row.OrderID, row.OrderTakeTransactionID, lostOrderID, f.take)
	}

	// THE ORDER'S TIMELINE NAMES THE REQUEST — one note, by the reporter; the seam moves no status.
	if len(f.orders.notes) != 1 {
		t.Fatalf("%d notes on the order's timeline, want 1", len(f.orders.notes))
	}

	note := f.orders.notes[0]
	if note.OrderID != lostOrderID || note.FoundRequestID != r.GetId() || note.Count != 9 || note.ProductCode != "KH-01" ||
		note.ProductName != "Kaos Hitam" || note.RackCode != "rak-c" || note.ActorID != opAni || note.IsOverride {
		t.Fatalf("the note = %+v, want order %d naming request %d: 9 × KH-01 Kaos Hitam on rak-c by Ani", note, lostOrderID, r.GetId())
	}

	res, err := f.approve(opAdmin(opBudi), r.GetId())
	if err != nil {
		t.Fatalf("approve: %v", err)
	}

	verifyTx(t, f.db, res.GetTransactionId())

	got := res.GetFoundRequest()
	if got.GetStatus() != inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_APPROVED || got.GetOrderId() != lostOrderID {
		t.Fatalf("approved %+v, want APPROVED naming order %d", got, lostOrderID)
	}

	orderMints(t, "what it posted", got.GetLines(), true, mintLine{8, 10000}, mintLine{1, 12000})

	minted := foundBatches(t, f.db, res.GetTransactionId())
	if len(minted) != 2 || minted[0].TeamID != otMelati || minted[0].InitStockCount != 8 || !san_money.Equal(minted[0].PriceUnit, 10000) ||
		minted[1].TeamID != otMelati || minted[1].InitStockCount != 1 || !san_money.Equal(minted[1].PriceUnit, 12000) {
		t.Fatalf("minted %+v, want Melati's 8 at Rp 10.000 and 1 at Rp 12.000", minted)
	}

	if n := rackCount(t, f.db, otKaosHitam, f.rakC); n != 9 {
		t.Fatalf("Rak C holds %d, want 9", n)
	}

	if ledgersAgree(t, f.db, otKaosHitam) != 9 {
		t.Fatalf("Kaos Hitam does not total 9 after the parcel came back")
	}

	var claims int64
	f.db.Model(&models.ProblemClaimedTransaction{}).Count(&claims)

	if claims != 0 || len(f.poster.damaged) != 0 {
		t.Fatalf("%d claims and %d liability postings, want none — the parcel was the order's, not the shelf's loss",
			claims, len(f.poster.damaged))
	}

	var tx models.InventoryTransaction
	f.db.First(&tx, res.GetTransactionId())

	if tx.TxType != models.TxFound || tx.TeamID != otMelati || !strings.Contains(tx.Description, "lost order #9301") {
		t.Fatalf("transaction %+v, want Melati's `found` naming lost order #9301", tx)
	}

	// The approval writes no second note: the order's timeline named the request at the report.
	if len(f.orders.notes) != 1 {
		t.Fatalf("%d notes after the approval, want still 1", len(f.orders.notes))
	}

	// THE LIST NAMES THE ORDER, and reads what it posted.
	list := f.foundList(t, opAdmin(opBudi), inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_APPROVED)
	if len(list) != 1 || list[0].GetOrderId() != lostOrderID {
		t.Fatalf("the approved list = %v, want the one request naming order %d", list, lostOrderID)
	}

	orderMints(t, "the list", list[0].GetLines(), true, mintLine{8, 10000}, mintLine{1, 12000})
}

// TWO FOUNDS OF ONE PARCEL FILL THE TAKE OLDEST FIRST, AND NEVER PAST IT. 5 come back first — all at batch 1's Rp 10.000.
// 4 more are reported: while they wait, one more is refused (5 approved + 4 waiting + 1 is past the 9 taken). The 4 come
// back at the rest of batch 1 (3 at Rp 10.000) and batch 2's one (Rp 12.000). A last one is refused: all 9 are back.
func TestFoundRequestOrder_TwoFoundsFillTheTakeOldestFirst(t *testing.T) {
	f := lostOrderStocked(t)

	first := f.mustReportFrom(t, lostOrderID, otKaosHitam, f.rakC, 5)
	orderMints(t, "the first preview", first.GetLines(), false, mintLine{5, 10000})

	_, err := f.approve(opAdmin(opBudi), first.GetId())
	if err != nil {
		t.Fatalf("approve the first: %v", err)
	}

	second := f.mustReportFrom(t, lostOrderID, otKaosHitam, f.rakC, 4)
	orderMints(t, "the second preview", second.GetLines(), false, mintLine{3, 10000}, mintLine{1, 12000})

	_, err = f.reportFrom(opStaff(opAni), lostOrderID, otKaosHitam, f.rakC, 1)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "more units") {
		t.Fatalf("a tenth unit while 4 wait: err = %v, want FailedPrecondition", err)
	}

	res, err := f.approve(opAdmin(opBudi), second.GetId())
	if err != nil {
		t.Fatalf("approve the second: %v", err)
	}

	verifyTx(t, f.db, res.GetTransactionId())
	orderMints(t, "the second posted", res.GetFoundRequest().GetLines(), true, mintLine{3, 10000}, mintLine{1, 12000})

	_, err = f.reportFrom(opStaff(opAni), lostOrderID, otKaosHitam, f.rakC, 1)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "more units") {
		t.Fatalf("a tenth unit after all 9: err = %v, want FailedPrecondition", err)
	}

	if ledgersAgree(t, f.db, otKaosHitam) != 10 {
		t.Fatalf("Kaos Hitam does not total 10 (1 left + 9 back)")
	}
}

// REFUSED — an order not lost, not shipped from here, another team's, one with no take, a product its take never drew,
// and a parcel already back as its return. Each refusal writes no request and no note.
func TestFoundRequestOrder_RefusedForAnOrderNotLostNotShippedHereOrAnotherTeams(t *testing.T) {
	f := lostOrderStocked(t)

	// Sinar's order 9306 took 2 Kaos Polos and was lost; Sinar's Kaos Ungu is stocked here since, never taken by it.
	sinar, err := f.svc.OrderTransactionCreate(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId: otSinar, IdempotencyKey: "key-lost-9306", WarehouseId: otWarehouse,
		Lines: []*inventoryv1.OrderTransactionLine{{ProductId: otKaosPolos, Quantity: 2}},
	}))
	if err != nil {
		t.Fatalf("Sinar's take: %v", err)
	}

	otRestock(t, f.svc, otSinar, opKaosUngu, 1, 5000, []*inventoryv1.RestockPlacement{{PlacementId: f.rakC, Quantity: 1}})

	// Melati's order 9309 took the last Kaos Hitam, and its parcel came back as its return.
	returned, err := orderKaosHitam(f.opnameFixture, "key-lost-9309", 1)
	if err != nil {
		t.Fatalf("the returned order's take: %v", err)
	}

	_, err = f.svc.OrderTransactionReturn(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionReturnRequest{
		TeamId: otWarehouse, SellingTeamId: otMelati, TakeTransactionId: returned.Msg.GetTransactionId(),
		Lines: []*inventoryv1.OrderTransactionReturnLine{{
			ProductId: otKaosHitam, ReturnProductId: otKaosHitam, Sound: 1,
			Placements: []*inventoryv1.OrderTransactionReturnPlacement{{PlacementId: f.rakC, Quantity: 1}},
		}},
	}))
	if err != nil {
		t.Fatalf("the return: %v", err)
	}

	lost := f.orders.orders[lostOrderID]
	shipped := lost
	shipped.ID, shipped.Status, shipped.Lost = 9302, "shipped", false
	elsewhere := lost
	elsewhere.ID, elsewhere.WarehouseID = 9303, 6
	noTake := lost
	noTake.ID, noTake.TakeTransactionID = 9308, 0
	backAlready := lost
	backAlready.ID, backAlready.TakeTransactionID = 9309, returned.Msg.GetTransactionId()

	f.orders.orders[shipped.ID] = shipped
	f.orders.orders[elsewhere.ID] = elsewhere
	f.orders.orders[noTake.ID] = noTake
	f.orders.orders[backAlready.ID] = backAlready
	f.orders.orders[9306] = inventory_v1.FoundOrder{
		ID: 9306, TeamID: otSinar, WarehouseID: otWarehouse, Status: "lost", Lost: true,
		TakeTransactionID: sinar.Msg.GetTransactionId(),
	}

	before := txCount(t, f.db)

	for _, c := range []struct {
		what    string
		order   uint64
		product uint64
		n       int64
		code    connect.Code
		says    string
	}{
		{"an order still shipped", 9302, otKaosHitam, 1, connect.CodeFailedPrecondition, "not lost"},
		{"an order another warehouse shipped", 9303, otKaosHitam, 1, connect.CodeNotFound, "no order #9303 shipped from this warehouse"},
		{"an order that does not exist", 9399, otKaosHitam, 1, connect.CodeNotFound, "no order #9399"},
		{"another team's product", lostOrderID, otKaosPolos, 1, connect.CodeFailedPrecondition, "own team's lost order"},
		{"an order with no take", 9308, otKaosHitam, 1, connect.CodeFailedPrecondition, "took no stock"},
		{"a product the take never drew", 9306, opKaosUngu, 1, connect.CodeFailedPrecondition, "never drew"},
		{"more than the take drew", 9306, otKaosPolos, 3, connect.CodeFailedPrecondition, "more units"},
		{"more than the take drew", lostOrderID, otKaosHitam, 10, connect.CodeFailedPrecondition, "more units"},
		{"a parcel already returned", 9309, otKaosHitam, 1, connect.CodeFailedPrecondition, "already came back"},
	} {
		_, err := f.reportFrom(opStaff(opAni), c.order, c.product, f.rakC, c.n)
		if connect.CodeOf(err) != c.code || !strings.Contains(err.Error(), c.says) {
			t.Fatalf("%s: err = %v, want %v saying %q", c.what, err, c.code, c.says)
		}
	}

	var n int64
	f.db.Model(&models.FoundRequest{}).Count(&n)

	if n != 0 || len(f.orders.notes) != 0 || txCount(t, f.db) != before {
		t.Fatalf("%d requests, %d notes, %d new transactions after only refusals — want none",
			n, len(f.orders.notes), txCount(t, f.db)-before)
	}

	// Sinar's own lost order, its own product, within its take: accepted.
	r := f.mustReportFrom(t, 9306, otKaosPolos, f.rakC, 2)
	orderMints(t, "Sinar's preview", r.GetLines(), false, mintLine{2, 20000})
}

// WITHOUT AN ORDER, NOTHING CHANGES. A found naming no order never asks the order side, writes no note, and claims the
// open loss first as before.
func TestFoundRequestOrder_WithoutAnOrderUnchanged(t *testing.T) {
	f := lostOrderStocked(t)
	bs := batchesOf(t, f.opnameFixture, otKaosHitam)
	f.lostOne(t, bs[1], f.rakB, 1)

	r := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakB, 1)

	if f.orders.asked != 0 || len(f.orders.notes) != 0 || r.GetOrderId() != 0 {
		t.Fatalf("asked the order side %d times, %d notes, order %d — want none", f.orders.asked, len(f.orders.notes), r.GetOrderId())
	}

	if row := foundRow(t, f.db, r.GetId()); row.OrderID != nil || row.OrderTakeTransactionID != nil {
		t.Fatalf("stored order %v take %v, want neither", row.OrderID, row.OrderTakeTransactionID)
	}

	lines := r.GetLines()
	if len(lines) != 1 || lines[0].GetType() != inventoryv1.FoundRequestPostType_FOUND_REQUEST_POST_TYPE_CLAIM ||
		!san_money.Equal(lines[0].GetPriceUnit(), 12000) {
		t.Fatalf("lines %v, want the open loss claimed back at Rp 12.000", lines)
	}

	res, err := f.approve(opAdmin(opBudi), r.GetId())
	if err != nil {
		t.Fatalf("approve: %v", err)
	}

	if got := res.GetFoundRequest().GetLines(); len(got) != 1 ||
		got[0].GetType() != inventoryv1.FoundRequestPostType_FOUND_REQUEST_POST_TYPE_CLAIM {
		t.Fatalf("posted %v, want the claim", got)
	}
}
