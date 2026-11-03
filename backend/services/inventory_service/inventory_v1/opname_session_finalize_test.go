package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// FINALIZE (broken-posts-as-written-the-rest-nets): broken as written, the rest netted per product over every rack —
// short is lost, over claims then mints, 0 is a move — in up to three transactions per owning team, listed by the
// session, every rack ending at its sellable count.

func txTypesOf(res *inventoryv1.OpnameSessionFinalizeResponse) []inventoryv1.OpnameTransactionType {
	out := make([]inventoryv1.OpnameTransactionType, 0, len(res.GetTransactions()))
	for _, tx := range res.GetTransactions() {
		out = append(out, tx.GetType())
	}

	return out
}

func verifyAll(t *testing.T, f *opnameFixture, res *inventoryv1.OpnameSessionFinalizeResponse) {
	t.Helper()

	for _, tx := range res.GetTransactions() {
		err := inventory_ledgers.Verify(f.db, tx.GetTransactionId())
		if err != nil {
			t.Fatalf("Verify %v %d: %v", tx.GetType(), tx.GetTransactionId(), err)
		}
	}
}

func batchesOf(t *testing.T, f *opnameFixture, product uint64) []models.Batch {
	t.Helper()

	var out []models.Batch
	f.db.Where("product_id = ? AND warehouse_id = ?", product, otWarehouse).Order("id").Find(&out)

	return out
}

// THE DECISION'S SECOND ROW — a tear and a move. Kaos Hitam: Rak A book 5, counted 3, one torn; Rak B book 5, counted 6.
// The rest is 9 − (10 − 1) = 0: the torn one is a `problem` (broken, the oldest batch), the other unit moved A → B is a
// `move`, and nobody pays for it.
func TestOpnameSessionFinalize_ATearAndAMove(t *testing.T) {
	f := opnameStocked(t)
	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosHitam, 0)

	f.countRow(t, opAni, s.GetId(), otKaosHitam, f.rakA, 3, 1)
	f.countRow(t, opAni, s.GetId(), otKaosHitam, f.rakB, 6, 0)

	res, err := f.finalize(opAdmin(opBudi), s.GetId())
	if err != nil {
		t.Fatalf("finalize: %v", err)
	}

	want := []inventoryv1.OpnameTransactionType{
		inventoryv1.OpnameTransactionType_OPNAME_TRANSACTION_TYPE_PROBLEM,
		inventoryv1.OpnameTransactionType_OPNAME_TRANSACTION_TYPE_MOVE,
	}
	if got := txTypesOf(res); len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("transactions %v, want problem then move", got)
	}

	verifyAll(t, f, res)

	if a, b := rackCount(t, f.db, otKaosHitam, f.rakA), rackCount(t, f.db, otKaosHitam, f.rakB); a != 3 || b != 6 {
		t.Fatalf("Rak A %d, Rak B %d — want each at its sellable count, 3 and 6", a, b)
	}

	if bs := batchesOf(t, f, otKaosHitam); bs[0].StockCount != 7 || bs[1].StockCount != 2 {
		t.Fatalf("batches %d and %d, want 7 and 2 — the torn one leaves the oldest", bs[0].StockCount, bs[1].StockCount)
	}

	var problems []models.WarehouseStockProblem
	f.db.Where("product_id = ?", otKaosHitam).Find(&problems)

	if len(problems) != 1 || problems[0].ProblemType != models.ProblemBroken || problems[0].ClaimableStockCount != 0 ||
		problems[0].PlacementID == nil || *problems[0].PlacementID != f.rakA || !san_money.Equal(problems[0].PriceUnit, 10000) {
		t.Fatalf("register %+v, want one broken row on Rak A at Rp 10.000, claimable 0", problems)
	}

	if problems[0].Note != "rak-a: torn at the seam" {
		t.Fatalf("problem note %q, want the draft's reason with its rack", problems[0].Note)
	}

	if len(f.poster.damaged) != 1 || f.poster.damaged[0].kind != inventory_v1.StockDamageBroken || f.poster.damaged[0].amount != 10000 ||
		f.poster.damaged[0].ownerTeamID != otMelati || f.poster.damaged[0].movementID != res.GetTransactions()[0].GetTransactionId() {
		t.Fatalf("liability %+v, want the warehouse owing Melati Rp 10.000 for one broken, keyed by the problem", f.poster.damaged)
	}

	if len(f.expense.posted) != 1 || f.expense.posted[0].amount != 10000 {
		t.Fatalf("expense %+v, want one write-off of Rp 10.000", f.expense.posted)
	}

	var listed int64
	f.db.Model(&models.OpnameSessionFinalTransaction{}).Where("opname_session_id = ?", s.GetId()).Count(&listed)
	if listed != 2 {
		t.Fatalf("the session lists %d transactions, want 2", listed)
	}

	if res.GetSession().GetStatus() != inventoryv1.OpnameSessionStatus_OPNAME_SESSION_STATUS_FINISH ||
		res.GetSession().GetFinalizedById() != opBudi {
		t.Fatalf("session %+v, want finished by Budi", res.GetSession())
	}

	// Released: the racks move again.
	err = f.moveOne(otKaosHitam, f.rakB, f.rakA)
	if err != nil {
		t.Fatalf("a move after the finalize: %v", err)
	}
}

// THE DECISION'S THIRD ROW, with an old loss waiting — a tear and an extra. A shelf report lost one Kaos Hitam of batch 2
// at Rp 12.000; then the count finds Rak A 5 with one torn and Rak B 5 against its book of 4. The rest is
// 10 − (9 − 1) = +2: the torn one is broken off the oldest batch, the +2 first claims the old loss back into batch 2 at
// its price — the team pays the warehouse back — and the last one is minted at the team's newest price here.
func TestOpnameSessionFinalize_ATearAndAnExtraClaimsThenMints(t *testing.T) {
	f := opnameStocked(t)
	b2 := batchesOf(t, f, otKaosHitam)[1]

	_, err := f.svc.StockAdjust(opAdmin(opBudi), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: otWarehouse, ProductId: otKaosHitam, Place: &inventoryv1.StockAdjustRequest_RackId{RackId: f.rakB},
		ReasonType: inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_LOST, BatchId: b2.ID, Quantity: 1, Reason: "gone from the shelf",
	}))
	if err != nil {
		t.Fatalf("report a lost unit: %v", err)
	}

	f.poster.damaged = nil
	f.expense.posted = nil

	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosHitam, 0)
	f.countRow(t, opAni, s.GetId(), otKaosHitam, f.rakA, 5, 1)
	f.countRow(t, opAni, s.GetId(), otKaosHitam, f.rakB, 5, 0)

	preview, err := f.preview(opAdmin(opBudi), s.GetId())
	if err != nil {
		t.Fatalf("preview: %v", err)
	}

	if len(preview.GetProducts()) != 1 || preview.GetProducts()[0].GetRestCount() != 2 ||
		!san_money.Equal(preview.GetOwedAmount(), 10000) || !san_money.Equal(preview.GetClaimedAmount(), 12000) ||
		!san_money.Equal(preview.GetMintedAmount(), 12000) {
		t.Fatalf("preview %+v, want rest +2, owed 10.000, claimed 12.000, minted 12.000", preview)
	}

	res, err := f.finalize(opAdmin(opBudi), s.GetId())
	if err != nil {
		t.Fatalf("finalize: %v", err)
	}

	verifyAll(t, f, res)

	if got := txTypesOf(res); len(got) != 2 || got[0] != inventoryv1.OpnameTransactionType_OPNAME_TRANSACTION_TYPE_PROBLEM ||
		got[1] != inventoryv1.OpnameTransactionType_OPNAME_TRANSACTION_TYPE_FOUND {
		t.Fatalf("transactions %v, want problem then found", got)
	}

	if a, b := rackCount(t, f.db, otKaosHitam, f.rakA), rackCount(t, f.db, otKaosHitam, f.rakB); a != 5 || b != 5 {
		t.Fatalf("Rak A %d, Rak B %d, want 5 and 5", a, b)
	}

	bs := batchesOf(t, f, otKaosHitam)
	if len(bs) != 3 || bs[0].StockCount != 7 || bs[1].StockCount != 2 || bs[2].StockCount != 1 || !san_money.Equal(bs[2].PriceUnit, 12000) {
		t.Fatalf("batches %+v, want 7 · 2 (the loss claimed back) · a new 1 at Rp 12.000", bs)
	}

	var loss models.WarehouseStockProblem
	f.db.Where("product_id = ? AND problem_type = ?", otKaosHitam, models.ProblemLost).Take(&loss)

	if loss.ClaimedStockCount != 1 {
		t.Fatalf("the old loss is claimed %d, want 1", loss.ClaimedStockCount)
	}

	var claims []models.ProblemClaimedTransaction
	f.db.Where("problem_id = ?", loss.ID).Find(&claims)

	if len(claims) != 1 || claims[0].ClaimedStockCount != 1 || claims[0].TransactionID != res.GetTransactions()[1].GetTransactionId() {
		t.Fatalf("claims %+v, want one of 1 unit by the found transaction", claims)
	}

	kinds := map[inventory_v1.StockDamageKind]int64{}
	for _, d := range f.poster.damaged {
		kinds[d.kind] += d.amount
	}

	if kinds[inventory_v1.StockDamageBroken] != 10000 || kinds[inventory_v1.StockDamageFound] != 12000 || len(f.poster.damaged) != 2 {
		t.Fatalf("liability %+v, want broken 10.000 owed and 12.000 given back by the claim — the mint moves none", f.poster.damaged)
	}
}

// A SHORTAGE WRITES A ROW PER BATCH, broken before lost, oldest first. Both racks empty, two torn on Rak A: broken 2 off
// batch 1, then lost 8 — 6 more off batch 1 and the 2 of batch 2, each at its batch's price. Netted over two short racks,
// the lost rows name no rack.
func TestOpnameSessionFinalize_AShortageWritesARowPerBatchBrokenBeforeLost(t *testing.T) {
	f := opnameStocked(t)
	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosHitam, 0)

	f.countRow(t, opAni, s.GetId(), otKaosHitam, f.rakA, 0, 2)
	f.countRow(t, opDodi, s.GetId(), otKaosHitam, f.rakB, 0, 0)

	res, err := f.finalize(opAdmin(opBudi), s.GetId())
	if err != nil {
		t.Fatalf("finalize: %v", err)
	}

	verifyAll(t, f, res)

	var problems []models.WarehouseStockProblem
	f.db.Where("product_id = ?", otKaosHitam).Order("id").Find(&problems)

	type want struct {
		kind  models.ProblemType
		n     int64
		price float64
	}

	wants := []want{{models.ProblemBroken, 2, 10000}, {models.ProblemLost, 6, 10000}, {models.ProblemLost, 2, 12000}}
	if len(problems) != len(wants) {
		t.Fatalf("register has %d rows, want 3: %+v", len(problems), problems)
	}

	for i, w := range wants {
		p := problems[i]
		if p.ProblemType != w.kind || p.ProblemStockCount != w.n || !san_money.Equal(p.PriceUnit, w.price) {
			t.Fatalf("row %d = %s %d at %v, want %s %d at %v", i, p.ProblemType, p.ProblemStockCount, p.PriceUnit, w.kind, w.n, w.price)
		}

		if p.ProblemType == models.ProblemLost && (p.PlacementID != nil || p.ClaimableStockCount != p.ProblemStockCount) {
			t.Fatalf("lost row %d: rack %v, claimable %d — want no rack and every unit claimable", i, p.PlacementID, p.ClaimableStockCount)
		}
	}

	if a, b := rackCount(t, f.db, otKaosHitam, f.rakA), rackCount(t, f.db, otKaosHitam, f.rakB); a != 0 || b != 0 {
		t.Fatalf("Rak A %d, Rak B %d, want both empty", a, b)
	}

	kinds := map[inventory_v1.StockDamageKind]int64{}
	for _, d := range f.poster.damaged {
		kinds[d.kind] += d.amount
	}

	if kinds[inventory_v1.StockDamageBroken] != 20000 || kinds[inventory_v1.StockDamageLost] != 84000 {
		t.Fatalf("liability %+v, want broken 20.000 and lost 84.000", kinds)
	}

	if len(f.expense.posted) != 1 || f.expense.posted[0].amount != 104000 {
		t.Fatalf("expense %+v, want one write-off of Rp 104.000", f.expense.posted)
	}
}

// A COUNT THAT MATCHES posts nothing — no transaction, no money — and only releases its rows.
func TestOpnameSessionFinalize_AnExactCountOnlyReleases(t *testing.T) {
	f := opnameStocked(t)
	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_ALL, 0, 0, 0)

	f.countRest(t, opAni, s.GetId())

	res, err := f.finalize(opAdmin(opBudi), s.GetId())
	if err != nil {
		t.Fatalf("finalize: %v", err)
	}

	if len(res.GetTransactions()) != 0 || len(f.poster.damaged) != 0 || len(f.expense.posted) != 0 {
		t.Fatalf("an exact count posted %+v, %+v, %+v", res.GetTransactions(), f.poster.damaged, f.expense.posted)
	}

	var open int64
	f.db.Model(&models.OpnameSessionSnapshot{}).Where("opname_session_id = ? AND released_at IS NULL", s.GetId()).Count(&open)
	if open != 0 {
		t.Fatalf("%d rows still hold their lock", open)
	}
}

// NOBODY FINALIZES THEIR OWN COUNT — checked against the person: Ani counted a row, and being the Admin too does not let
// her confirm it. Nor can anybody finalize a count with rows left, or one already finished.
func TestOpnameSessionFinalize_RefusesACounterRowsLeftAndAFinishedCount(t *testing.T) {
	f := opnameStocked(t)
	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosPolos, 0)

	_, err := f.finalize(opAdmin(opBudi), s.GetId())
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("rows left: err = %v, want FailedPrecondition", err)
	}

	f.countRest(t, opAni, s.GetId())

	_, err = f.finalize(opAdmin(opAni), s.GetId())
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("Ani finalizing her own count: err = %v, want FailedPrecondition", err)
	}

	_, err = f.finalize(opAdmin(opBudi), s.GetId())
	if err != nil {
		t.Fatalf("Budi: %v", err)
	}

	_, err = f.finalize(opAdmin(opBudi), s.GetId())
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("twice: err = %v, want FailedPrecondition", err)
	}
}

// ROOT FINALIZES ONLY AS AN OVERRIDE (root-finalizes-only-as-an-override): allowed, and every transaction it writes is
// stamped — the session itself carries no flag (finalizing-is-the-agreement).
func TestOpnameSessionFinalize_RootIsStampedAsAnOverride(t *testing.T) {
	f := opnameStocked(t)
	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosPolos, 0)

	f.countRow(t, opAni, s.GetId(), otKaosPolos, f.rakA, 3, 0)

	res, err := f.finalize(opRootCtx(), s.GetId())
	if err != nil {
		t.Fatalf("finalize as Root: %v", err)
	}

	if res.GetSession().GetFinalizedById() != opRoot {
		t.Fatalf("finalized by %d, want Root", res.GetSession().GetFinalizedById())
	}

	actor, override := lastTransactionOverride(t, f.db, string(models.TxProblem))
	if actor != opRoot || !override {
		t.Fatalf("problem transaction by %d, override %v — want Root, stamped", actor, override)
	}
}

// A FINISHED COUNT IS "LAST COUNTED" on every rack it held, even one it found exact (it writes no row there).
func TestOpnameSessionFinalize_MarksTheRacksCounted(t *testing.T) {
	f := opnameStocked(t)
	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosPolos, 0)

	f.countRest(t, opAni, s.GetId())

	_, err := f.finalize(opAdmin(opBudi), s.GetId())
	if err != nil {
		t.Fatalf("finalize: %v", err)
	}

	detail, err := f.svc.RackDetail(opAdmin(opBudi), connect.NewRequest(&inventoryv1.RackDetailRequest{TeamId: otWarehouse, RackId: f.rakA}))
	if err != nil {
		t.Fatalf("rack detail: %v", err)
	}

	if detail.Msg.GetSummary().GetLastCountedAt() == "" {
		t.Fatalf("Rak A reads as never counted after a finished count")
	}
}
