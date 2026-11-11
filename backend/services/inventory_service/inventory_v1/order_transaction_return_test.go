package inventory_v1_test

import (
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// AN ORDER'S RETURN BACK ON THE SHELF (docs/business/inventory/return_decision.md).
//
//	Gudang 5 shipped Melati's order: Kaos Hitam ×3 (her own) and Kaos Polos ×3 (Sinar's, 20 % markup), each drawn as
//	2 from a batch at Rp 10.000 (exp 2027-03, supplier 41) and 1 from a batch at Rp 12.000 (exp 2027-06, supplier 42).
//	Melati's return warehouse is Gudang 6, which never held either: Rak R1, Rak R2. Kaos Polos comes back as Melati's
//	own mapped product 711.

const (
	rtShipWarehouse   = otWarehouse
	rtReturnWarehouse = uint64(6)
	rtOwnPolos        = uint64(711)
	rtCrew            = uint64(41)
)

type rtFixture struct {
	svc     *inventory_v1.Service
	db      *gorm.DB
	poster  *recordingPoster
	expense *recordingExpense

	rakA, rakR1, rakR2 uint64
	take               uint64
}

var (
	rtExpMarch = time.Date(2027, 3, 1, 0, 0, 0, 0, time.UTC)
	rtExpJune  = time.Date(2027, 6, 1, 0, 0, 0, 0, time.UTC)
)

func rtStocked(t *testing.T) *rtFixture {
	t.Helper()

	f := &rtFixture{db: san_testdb.DB(t), poster: &recordingPoster{}, expense: &recordingExpense{}}
	f.svc = inventory_v1.NewService(f.db, f.poster, f.expense, nil, nil, fakeFacts{
		otKaosHitam: {TeamID: otMelati, ProductCode: "KH-001", Name: "Kaos Hitam"},
		otKaosPolos: {TeamID: otSinar, ProductCode: "KP-001", Name: "Kaos Polos", CrossMarkupBps: 2000},
	}, nil, nil)

	f.rakA = newRack(t, f.svc, rtShipWarehouse, "rak-a")
	f.rakR1 = newRack(t, f.svc, rtReturnWarehouse, "rak-r1")
	f.rakR2 = newRack(t, f.svc, rtReturnWarehouse, "rak-r2")

	for _, stock := range []struct {
		team, product uint64
	}{{otMelati, otKaosHitam}, {otSinar, otKaosPolos}} {
		otRestock(t, f.svc, stock.team, stock.product, 2, 20000, []*inventoryv1.RestockPlacement{{PlacementId: f.rakA, Quantity: 2}})
		otRestock(t, f.svc, stock.team, stock.product, 1, 12000, []*inventoryv1.RestockPlacement{{PlacementId: f.rakA, Quantity: 1}})
	}

	// The facts a restock with no supplier cannot write: each batch's supplier, channel and expiry.
	err := f.db.Exec(`UPDATE batches SET supplier_id = 41, supplier_channel_id = 51, expired_at = ?
		WHERE warehouse_id = ? AND init_stock_count = 2`, rtExpMarch, rtShipWarehouse).Error
	if err != nil {
		t.Fatalf("give the first batches their supplier: %v", err)
	}

	err = f.db.Exec(`UPDATE batches SET supplier_id = 42, supplier_channel_id = 52, expired_at = ?
		WHERE warehouse_id = ? AND init_stock_count = 1`, rtExpJune, rtShipWarehouse).Error
	if err != nil {
		t.Fatalf("give the second batches their supplier: %v", err)
	}

	res, err := take(f.svc, "key-rt", line(otKaosHitam, 3), line(otKaosPolos, 3))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	f.take = res.GetTransactionId()

	return f
}

// rtLine is one product of the return, every sound unit on one rack.
func rtLine(product, returnAs uint64, rate float64, sound, broken, missing int64, rack uint64) *inventoryv1.OrderTransactionReturnLine {
	l := &inventoryv1.OrderTransactionReturnLine{
		ProductId: product, ReturnProductId: returnAs, MarkupRate: rate, Sound: sound, Broken: broken, Missing: missing,
	}
	if sound > 0 {
		l.Placements = []*inventoryv1.OrderTransactionReturnPlacement{{PlacementId: rack, Quantity: sound}}
	}

	return l
}

func (f *rtFixture) wholePolos() *inventoryv1.OrderTransactionReturnLine {
	return rtLine(otKaosPolos, rtOwnPolos, 0.2, 3, 0, 0, f.rakR2)
}

func (f *rtFixture) ret(warehouse uint64, lines ...*inventoryv1.OrderTransactionReturnLine) (*inventoryv1.OrderTransactionReturnResponse, error) {
	res, err := f.svc.OrderTransactionReturn(ctxUser(rtCrew), connect.NewRequest(&inventoryv1.OrderTransactionReturnRequest{
		TeamId: warehouse, SellingTeamId: otMelati, TakeTransactionId: f.take, Lines: lines, Description: "return of order #12",
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

type rtBatch struct {
	TeamID            uint64
	ProductID         uint64
	InitStockCount    int64
	PriceUnit         float64
	SupplierID        uint64
	SupplierChannelID uint64
	ExpiredAt         *time.Time
	TransactionID     uint64
}

func batchesAt(t *testing.T, db *gorm.DB, warehouse uint64) []rtBatch {
	t.Helper()

	var rows []rtBatch

	err := db.Raw(`SELECT team_id, product_id, init_stock_count, price_unit, supplier_id, supplier_channel_id, expired_at,
			transaction_id
		FROM batches WHERE warehouse_id = ? ORDER BY id`, warehouse).Scan(&rows).Error
	if err != nil {
		t.Fatalf("batches at %d: %v", warehouse, err)
	}

	return rows
}

func wantBatch(t *testing.T, got rtBatch, product uint64, count int64, price float64, supplier uint64, exp time.Time) {
	t.Helper()

	if got.TeamID != otMelati || got.ProductID != product || got.InitStockCount != count || !san_money.Equal(got.PriceUnit, price) ||
		got.SupplierID != supplier || got.SupplierChannelID != supplier+10 || got.ExpiredAt == nil || !got.ExpiredAt.Equal(exp) {
		t.Fatalf("batch %+v, want Melati's %d × product %d at %v, supplier %d, exp %v", got, count, product, price, supplier, exp)
	}
}

// A WHOLE PARCEL, IN ANOTHER WAREHOUSE (a-return-mints-one-batch-per-batch-the-order-took,
// a-return-may-land-in-another-warehouse): the return warehouse mints one batch per batch the take drew — 2 × Rp 10.000
// and 1 × Rp 12.000, each keeping its expiry and supplier — owned by Melati, on the rack named, in ONE `return`
// transaction of hers at Gudang 6; the item equals its batches (Rp 32.000, the order's COGS) and both ledgers agree. The
// shipping warehouse's batches are untouched, and the product is linked to the return warehouse.
func TestOrderTransactionReturn_MintsABatchPerBatchTheTakeDrew(t *testing.T) {
	f := rtStocked(t)
	before := batchesAt(t, f.db, rtShipWarehouse)

	got, err := f.ret(rtReturnWarehouse, rtLine(otKaosHitam, otKaosHitam, 0, 3, 0, 0, f.rakR1), f.wholePolos())
	if err != nil {
		t.Fatalf("return: %v", err)
	}

	if !got.GetPosted() || got.GetTransactionId() == 0 || len(got.GetProblems()) != 0 {
		t.Fatalf("answer %+v, want a posted return with no door rows", got)
	}

	var tx struct {
		WarehouseID uint64
		TeamID      uint64
		TxType      string
	}

	f.db.Raw(`SELECT warehouse_id, team_id, tx_type FROM inventory_transactions WHERE id = ?`, got.GetTransactionId()).Scan(&tx)
	if tx.WarehouseID != rtReturnWarehouse || tx.TeamID != otMelati || tx.TxType != "return" {
		t.Fatalf("transaction %+v, want Melati's return at Gudang %d", tx, rtReturnWarehouse)
	}

	minted := batchesAt(t, f.db, rtReturnWarehouse)
	if len(minted) != 4 {
		t.Fatalf("%d batches at the return warehouse, want 4 — one per batch each line drew: %+v", len(minted), minted)
	}

	wantBatch(t, minted[0], otKaosHitam, 2, 10000, 41, rtExpMarch)
	wantBatch(t, minted[1], otKaosHitam, 1, 12000, 42, rtExpJune)

	for _, b := range minted {
		if b.TransactionID != got.GetTransactionId() {
			t.Fatalf("batch %+v minted outside the return transaction %d", b, got.GetTransactionId())
		}
	}

	if _, racks := unitsAt(t, f.db, rtReturnWarehouse, otKaosHitam); racks != 3 || rackCount(t, f.db, otKaosHitam, f.rakR1) != 3 {
		t.Fatalf("Kaos Hitam on the return warehouse's racks: %d (Rak R1 %d), want all 3 on Rak R1", racks,
			rackCount(t, f.db, otKaosHitam, f.rakR1))
	}

	var item struct {
		Quantity      int64
		Total         float64
		ProductTeamID uint64
		IsOwned       bool
	}

	f.db.Raw(`SELECT quantity, total, product_team_id, is_owned FROM inventory_transaction_items
		WHERE transaction_id = ? AND product_id = ?`, got.GetTransactionId(), otKaosHitam).Scan(&item)
	if item.Quantity != 3 || !san_money.Equal(item.Total, 32000) || item.ProductTeamID != otMelati || !item.IsOwned {
		t.Fatalf("item %+v, want Melati's own 3 at Rp 32.000 — the order's COGS", item)
	}

	err = inventory_ledgers.Verify(f.db, got.GetTransactionId())
	if err != nil {
		t.Fatalf("verify: %v", err)
	}

	if after := batchesAt(t, f.db, rtShipWarehouse); len(after) != len(before) {
		t.Fatalf("the shipping warehouse holds %d batches after the return, %d before — the take stays", len(after), len(before))
	}

	var linked int64

	f.db.Raw(`SELECT count(*) FROM warehouse_products WHERE warehouse_id = ? AND product_id IN ?`, rtReturnWarehouse,
		[]uint64{otKaosHitam, rtOwnPolos}).Scan(&linked)
	if linked != 2 {
		t.Fatalf("%d of the returned products linked to the return warehouse, want both", linked)
	}
}

// A BORROWED LINE (a-return-mints-one-batch-per-batch-the-order-took, a-returned-borrowed-unit-is-relabelled-at-the-accept):
// each minted layer carries the markup Melati paid on it — 2 × Rp 12.000 + 1 × Rp 14.400 = Rp 38.400 — under her mapped
// own product, owned by her; Sinar's batches are untouched.
func TestOrderTransactionReturn_ABorrowedLineComesBackAsTheOwnProductAtTheMarkup(t *testing.T) {
	f := rtStocked(t)

	var sinarBefore float64

	f.db.Raw(`SELECT COALESCE(SUM(stock_valuation), 0) FROM batches WHERE team_id = ?`, otSinar).Scan(&sinarBefore)

	got, err := f.ret(rtReturnWarehouse, rtLine(otKaosHitam, otKaosHitam, 0, 3, 0, 0, f.rakR1), f.wholePolos())
	if err != nil {
		t.Fatalf("return: %v", err)
	}

	minted := batchesAt(t, f.db, rtReturnWarehouse)
	wantBatch(t, minted[2], rtOwnPolos, 2, 12000, 41, rtExpMarch)
	wantBatch(t, minted[3], rtOwnPolos, 1, 14400, 42, rtExpJune)

	var total float64

	f.db.Raw(`SELECT total FROM inventory_transaction_items WHERE transaction_id = ? AND product_id = ?`,
		got.GetTransactionId(), rtOwnPolos).Scan(&total)
	if !san_money.Equal(total, 38400) {
		t.Fatalf("the borrowed line came back at Rp %v, want Rp 38.400 — what Melati paid", total)
	}

	if rackCount(t, f.db, rtOwnPolos, f.rakR2) != 3 || rackCount(t, f.db, otKaosPolos, f.rakR2) != 0 {
		t.Fatal("Rak R2 should hold 3 of Melati's own product, none of Sinar's")
	}

	var sinarAfter float64

	f.db.Raw(`SELECT COALESCE(SUM(stock_valuation), 0) FROM batches WHERE team_id = ?`, otSinar).Scan(&sinarAfter)
	if !san_money.Equal(sinarAfter, sinarBefore) {
		t.Fatalf("Sinar's batches moved from Rp %v to Rp %v — the lender's batches are untouched", sinarBefore, sinarAfter)
	}

	err = inventory_ledgers.Verify(f.db, got.GetTransactionId())
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
}

// BROKEN AND MISSING ARE DOOR ROWS (a-short-return-is-missing-at-the-door, a-broken-returned-unit-is-thrown-away-at-the-door,
// a-return-door-row-carries-an-optional-note): of 3 Kaos Hitam, 1 sound fills the oldest layer (Rp 10.000); the broken
// one comes off the newest (Rp 12.000), the missing one the next (Rp 10.000) — each a row of the return's door table
// with the crew's note, the selling team's: no payable, no stock-loss expense, no problem transaction, no Inventory Lost.
func TestOrderTransactionReturn_BrokenAndMissingAreDoorRowsNotTheWarehouses(t *testing.T) {
	f := rtStocked(t)

	hitam := rtLine(otKaosHitam, otKaosHitam, 0, 1, 1, 1, f.rakR1)
	hitam.Note = "sobek di jahitan"

	got, err := f.ret(rtReturnWarehouse, hitam, f.wholePolos())
	if err != nil {
		t.Fatalf("return: %v", err)
	}

	if len(got.GetProblems()) != 2 {
		t.Fatalf("door rows %v, want broken and missing", got.GetProblems())
	}

	broken, missing := got.GetProblems()[0], got.GetProblems()[1]
	if broken.GetType() != inventoryv1.OrderTransactionReturnProblemType_ORDER_TRANSACTION_RETURN_PROBLEM_TYPE_BROKEN ||
		broken.GetCount() != 1 || !san_money.Equal(broken.GetTotal(), 12000) || broken.GetNote() != "sobek di jahitan" {
		t.Fatalf("broken row %+v, want 1 at Rp 12.000 off the newest layer, with the note", broken)
	}

	if missing.GetType() != inventoryv1.OrderTransactionReturnProblemType_ORDER_TRANSACTION_RETURN_PROBLEM_TYPE_MISSING ||
		missing.GetCount() != 1 || !san_money.Equal(missing.GetTotal(), 10000) || missing.GetProductId() != otKaosHitam {
		t.Fatalf("missing row %+v, want 1 Kaos Hitam at Rp 10.000", missing)
	}

	var stored int64

	f.db.Raw(`SELECT count(*) FROM order_return_problem_items WHERE transaction_id = ? AND note = 'sobek di jahitan'`,
		got.GetTransactionId()).Scan(&stored)
	if stored != 2 {
		t.Fatalf("%d door rows stored with the note, want 2", stored)
	}

	minted := batchesAt(t, f.db, rtReturnWarehouse)
	wantBatch(t, minted[0], otKaosHitam, 1, 10000, 41, rtExpMarch)

	if rackCount(t, f.db, otKaosHitam, f.rakR1) != 1 {
		t.Fatal("only the one sound Kaos Hitam goes on the shelf")
	}

	if len(f.poster.damaged) != 0 || len(f.expense.posted) != 0 {
		t.Fatalf("the warehouse was charged for the door's units: payable %v, expense %v", f.poster.damaged, f.expense.posted)
	}

	var custody int64

	f.db.Raw(`SELECT (SELECT count(*) FROM warehouse_stock_problems WHERE warehouse_id = @w) +
		(SELECT count(*) FROM inventory_lost_daily_reports WHERE warehouse_id = @w) +
		(SELECT count(*) FROM inventory_transactions WHERE warehouse_id = @w AND tx_type <> 'return')`,
		map[string]any{"w": rtReturnWarehouse}).Scan(&custody)
	if custody != 0 {
		t.Fatalf("%d custody rows (stock problems, Inventory Lost, other transactions) for a door loss, want none", custody)
	}

	err = inventory_ledgers.Verify(f.db, got.GetTransactionId())
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
}

// ONCE PER ORDER: a second return of the same take — a retried or raced accept, here with another count — writes
// nothing and answers the first one's transaction and door rows (posted = false).
func TestOrderTransactionReturn_IsWrittenOnce(t *testing.T) {
	f := rtStocked(t)

	hitam := rtLine(otKaosHitam, otKaosHitam, 0, 2, 0, 1, f.rakR1)

	first, err := f.ret(rtReturnWarehouse, hitam, f.wholePolos())
	if err != nil {
		t.Fatalf("first return: %v", err)
	}

	again, err := f.ret(rtReturnWarehouse, rtLine(otKaosHitam, otKaosHitam, 0, 3, 0, 0, f.rakR2), f.wholePolos())
	if err != nil {
		t.Fatalf("second return: %v", err)
	}

	if again.GetPosted() || again.GetTransactionId() != first.GetTransactionId() || len(again.GetProblems()) != 1 {
		t.Fatalf("second answer %+v, want the first return (%d) and its one missing row, not posted", again,
			first.GetTransactionId())
	}

	var returns int64

	f.db.Raw(`SELECT count(*) FROM inventory_transactions WHERE tx_type = 'return' AND team_id = ?`, otMelati).Scan(&returns)
	if returns != 1 {
		t.Fatalf("%d return transactions, want one", returns)
	}

	if rackCount(t, f.db, otKaosHitam, f.rakR2) != 0 || rackCount(t, f.db, otKaosHitam, f.rakR1) != 2 {
		t.Fatal("the second return put units on a rack")
	}
}

// REFUSED WHOLE, AND NOTHING WRITTEN: a rack of another warehouse (NotFound), a count that does not fit the take, an own
// line coming back as another product, a borrowed one coming back as the lender's, a take that is not this team's order.
func TestOrderTransactionReturn_RefusesWhatDoesNotFit(t *testing.T) {
	f := rtStocked(t)

	cases := []struct {
		name  string
		code  connect.Code
		lines []*inventoryv1.OrderTransactionReturnLine
	}{
		{"a rack of the shipping warehouse", connect.CodeNotFound,
			[]*inventoryv1.OrderTransactionReturnLine{rtLine(otKaosHitam, otKaosHitam, 0, 3, 0, 0, f.rakA), f.wholePolos()}},
		{"fewer units than the take drew", connect.CodeInvalidArgument,
			[]*inventoryv1.OrderTransactionReturnLine{rtLine(otKaosHitam, otKaosHitam, 0, 2, 0, 0, f.rakR1), f.wholePolos()}},
		{"a product the take never drew", connect.CodeInvalidArgument,
			[]*inventoryv1.OrderTransactionReturnLine{rtLine(otKaosMerah, otKaosMerah, 0, 3, 0, 0, f.rakR1), f.wholePolos()}},
		{"a line missing", connect.CodeInvalidArgument,
			[]*inventoryv1.OrderTransactionReturnLine{f.wholePolos()}},
		{"an own line as another product", connect.CodeInvalidArgument,
			[]*inventoryv1.OrderTransactionReturnLine{rtLine(otKaosHitam, rtOwnPolos, 0, 3, 0, 0, f.rakR1), f.wholePolos()}},
		{"a borrowed line as the lender's product", connect.CodeInvalidArgument,
			[]*inventoryv1.OrderTransactionReturnLine{rtLine(otKaosHitam, otKaosHitam, 0, 3, 0, 0, f.rakR1),
				rtLine(otKaosPolos, otKaosPolos, 0.2, 3, 0, 0, f.rakR2)}},
	}

	for _, c := range cases {
		_, err := f.ret(rtReturnWarehouse, c.lines...)
		wantCode(t, err, c.code, c.name)
	}

	_, err := f.svc.OrderTransactionReturn(ctxUser(rtCrew), connect.NewRequest(&inventoryv1.OrderTransactionReturnRequest{
		TeamId: rtReturnWarehouse, SellingTeamId: otSinar, TakeTransactionId: f.take,
		Lines: []*inventoryv1.OrderTransactionReturnLine{f.wholePolos()},
	}))
	wantCode(t, err, connect.CodeNotFound, "another team's take")

	if n := len(batchesAt(t, f.db, rtReturnWarehouse)); n != 0 {
		t.Fatalf("%d batches at the return warehouse after refusals, want none", n)
	}

	var returns int64

	f.db.Raw(`SELECT count(*) FROM inventory_transactions WHERE tx_type = 'return' AND team_id = ?`, otMelati).Scan(&returns)
	if returns != 0 {
		t.Fatalf("%d return transactions after refusals, want none", returns)
	}
}

// A CANCELLED ORDER'S TAKE IS NOT RETURNED: its units went back when it was released.
func TestOrderTransactionReturn_RefusesARolledBackTake(t *testing.T) {
	f := rtStocked(t)

	_, err := f.svc.OrderTransactionRelease(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
		TeamId: otMelati, IdempotencyKey: "key-rt",
	}))
	if err != nil {
		t.Fatalf("release: %v", err)
	}

	_, err = f.ret(rtReturnWarehouse, rtLine(otKaosHitam, otKaosHitam, 0, 3, 0, 0, f.rakR1), f.wholePolos())
	wantCode(t, err, connect.CodeNotFound, "a rolled-back take")
}

// A COUNT HOLDS THE RACK (a-lock-stops-sales-and-cancels-too): Melati's parcel back at Gudang 5 — her return warehouse is
// the one that shipped it — while Kaos Hitam is counted on Rak A. A put-away there is refused naming the count, and the
// whole return with it.
func TestOrderTransactionReturn_RefusesARackACountHolds(t *testing.T) {
	f := opnameStocked(t)

	took, err := orderKaosHitam(f, "key-rt-count", 3)
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	countKaosHitam(t, f)

	_, err = f.svc.OrderTransactionReturn(ctxUser(rtCrew), connect.NewRequest(&inventoryv1.OrderTransactionReturnRequest{
		TeamId: otWarehouse, SellingTeamId: otMelati, TakeTransactionId: took.Msg.GetTransactionId(),
		Lines: []*inventoryv1.OrderTransactionReturnLine{rtLine(otKaosHitam, otKaosHitam, 0, 3, 0, 0, f.rakA)},
	}))
	refusedByTheCount(t, "a return onto a counted rack", err)

	var returns int64

	f.db.Raw(`SELECT count(*) FROM inventory_transactions WHERE tx_type = 'return' AND team_id = ?`, otMelati).Scan(&returns)
	if returns != 0 {
		t.Fatalf("%d return transactions after the refusal, want none", returns)
	}
}
