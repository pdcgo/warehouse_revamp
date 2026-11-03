package inventory_v1_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// APPROVING A FOUND (an-adjust-found-waits-for-the-owner-or-admin): the warehouse Owner or Admin — never the reporter —
// posts ONE `found` transaction through the stock count's own found: the oldest open losses claimed back into their
// batches at their price, the rest minted at the team's newest batch price here, both ledgers moving the same units.

// THE REPORTER NEVER APPROVES — checked against the person, never the role: Budi, the Admin, reported it, so Budi may
// not approve it; Dewi, the Owner, may.
func TestFoundRequestApprove_TheReporterCannotTheOwnerCan(t *testing.T) {
	f := opnameStocked(t)
	r := f.mustReport(t, opAdmin(opBudi), otKaosHitam, f.rakA, 1)

	_, err := f.approve(opAdmin(opBudi), r.GetId())
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "you reported") {
		t.Fatalf("the reporter approving: err = %v, want FailedPrecondition", err)
	}

	res, err := f.approve(opOwner(opDewi), r.GetId())
	if err != nil {
		t.Fatalf("the Owner approving: %v", err)
	}

	got := res.GetFoundRequest()
	if got.GetStatus() != inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_APPROVED || got.GetDecidedById() != opDewi ||
		got.GetTransactionId() != res.GetTransactionId() || res.GetTransactionId() == 0 {
		t.Fatalf("approved %+v, want APPROVED by Dewi naming its transaction", got)
	}

	verifyTx(t, f.db, res.GetTransactionId())

	if n := rackCount(t, f.db, otKaosHitam, f.rakA); n != 6 {
		t.Fatalf("Rak A holds %d, want 6", n)
	}

	if ledgersAgree(t, f.db, otKaosHitam) != 11 {
		t.Fatalf("Kaos Hitam does not total 11 after one found")
	}
}

// THE OLDEST LOSS FIRST, ACROSS TWO LOSSES AT TWO PRICES, THEN THE MINT AT THE NEWEST PRICE. One Kaos Hitam of batch 2
// (Rp 12.000) was lost first, then two of batch 1 (Rp 10.000). Four are found on Rak A: the first loss is claimed back
// (1 × 12.000), then the second (2 × 10.000), and the last unit is minted at the team's newest batch price here —
// batch 2's Rp 12.000. The team pays the warehouse back Rp 32.000; the mint moves no money.
func TestFoundRequestApprove_ClaimsTheOldestLossFirstThenMints(t *testing.T) {
	f := opnameStocked(t)
	bs := batchesOf(t, f, otKaosHitam)

	f.lostOne(t, bs[1], f.rakB, 1)
	f.lostOne(t, bs[0], f.rakA, 2)

	f.poster.damaged = nil
	f.expense.posted = nil

	r := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakA, 4)

	res, err := f.approve(opAdmin(opBudi), r.GetId())
	if err != nil {
		t.Fatalf("approve: %v", err)
	}

	got := res.GetFoundRequest()
	lines := got.GetLines()

	type want struct {
		kind  inventoryv1.FoundRequestPostType
		batch uint64
		n     int64
		price float64
	}

	claim, mint := inventoryv1.FoundRequestPostType_FOUND_REQUEST_POST_TYPE_CLAIM, inventoryv1.FoundRequestPostType_FOUND_REQUEST_POST_TYPE_MINT
	wants := []want{{claim, bs[1].ID, 1, 12000}, {claim, bs[0].ID, 2, 10000}, {mint, 0, 1, 12000}}

	if len(lines) != len(wants) {
		t.Fatalf("lines %+v, want 2 claims then a mint", lines)
	}

	for i, w := range wants {
		l := lines[i]
		if l.GetType() != w.kind || l.GetStockCount() != w.n || !san_money.Equal(l.GetPriceUnit(), w.price) ||
			(w.batch != 0 && l.GetBatchId() != w.batch) {
			t.Fatalf("line %d = %+v, want %v %d at %v into batch %d", i, l, w.kind, w.n, w.price, w.batch)
		}
	}

	if !san_money.Equal(got.GetClaimedAmount(), 32000) || !san_money.Equal(got.GetMintedAmount(), 12000) {
		t.Fatalf("claimed %v, minted %v — want 32.000 and 12.000", got.GetClaimedAmount(), got.GetMintedAmount())
	}

	verifyTx(t, f.db, res.GetTransactionId())

	after := batchesOf(t, f, otKaosHitam)
	if len(after) != 3 || after[0].StockCount != 8 || after[1].StockCount != 2 || after[2].StockCount != 1 ||
		!san_money.Equal(after[2].PriceUnit, 12000) || lines[2].GetBatchId() != after[2].ID {
		t.Fatalf("batches %+v, want 8 · 2 (each loss back) · a new 1 at Rp 12.000 named on the mint line", after)
	}

	var losses []models.WarehouseStockProblem
	f.db.Where("product_id = ? AND problem_type = ?", otKaosHitam, models.ProblemLost).Order("id").Find(&losses)

	if len(losses) != 2 || losses[0].ClaimedStockCount != 1 || losses[1].ClaimedStockCount != 2 {
		t.Fatalf("losses %+v, want both claimed in full", losses)
	}

	var claims int64
	f.db.Model(&models.ProblemClaimedTransaction{}).Where("transaction_id = ?", res.GetTransactionId()).Count(&claims)
	if claims != 2 {
		t.Fatalf("%d claim rows, want 2 — one per loss, naming the found transaction", claims)
	}

	if len(f.poster.damaged) != 1 || f.poster.damaged[0].kind != inventory_v1.StockDamageFound ||
		f.poster.damaged[0].amount != 32000 || f.poster.damaged[0].ownerTeamID != otMelati ||
		f.poster.damaged[0].movementID != res.GetTransactionId() {
		t.Fatalf("liability %+v, want the claims' Rp 32.000 given back by Melati, keyed by the found", f.poster.damaged)
	}

	if len(f.expense.posted) != 0 {
		t.Fatalf("a found wrote off %+v", f.expense.posted)
	}

	// Both ledgers move the same units: Rak A 5 − 2 lost + 4 found.
	if n := rackCount(t, f.db, otKaosHitam, f.rakA); n != 7 {
		t.Fatalf("Rak A holds %d, want 7", n)
	}

	if ledgersAgree(t, f.db, otKaosHitam) != 11 {
		t.Fatalf("Kaos Hitam does not total 11")
	}

	row := foundRow(t, f.db, r.GetId())
	if row.MintedBatchID == nil || *row.MintedBatchID != after[2].ID {
		t.Fatalf("the request names minted batch %v, want %d", row.MintedBatchID, after[2].ID)
	}
}

// A LOSS IS CLAIMED BACK ONCE (a-claim-records-its-units). One unit lost, two founds of one waiting: the first approval
// claims it, the second has nothing left to claim and mints.
func TestFoundRequestApprove_NeverClaimsMoreThanClaimable(t *testing.T) {
	f := opnameStocked(t)
	f.lostOne(t, batchesOf(t, f, otKaosHitam)[0], f.rakA, 1)

	first := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakA, 1)
	second := f.mustReport(t, opStaff(opDodi), otKaosHitam, f.rakB, 1)

	// Each, read alone, would claim the one loss.
	for _, r := range f.foundList(t, opAdmin(opBudi), inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_WAITING) {
		if r.GetLines()[0].GetType() != inventoryv1.FoundRequestPostType_FOUND_REQUEST_POST_TYPE_CLAIM {
			t.Fatalf("request %d would post %+v, want the claim", r.GetId(), r.GetLines())
		}
	}

	_, err := f.approve(opAdmin(opBudi), first.GetId())
	if err != nil {
		t.Fatalf("first: %v", err)
	}

	res, err := f.approve(opAdmin(opBudi), second.GetId())
	if err != nil {
		t.Fatalf("second: %v", err)
	}

	if lines := res.GetFoundRequest().GetLines(); len(lines) != 1 ||
		lines[0].GetType() != inventoryv1.FoundRequestPostType_FOUND_REQUEST_POST_TYPE_MINT {
		t.Fatalf("the second posted %+v, want a mint — the loss is claimed", lines)
	}

	var loss models.WarehouseStockProblem
	f.db.Where("product_id = ? AND problem_type = ?", otKaosHitam, models.ProblemLost).Take(&loss)
	if loss.ClaimedStockCount != 1 {
		t.Fatalf("the loss is claimed %d times its 1 unit", loss.ClaimedStockCount)
	}
}

// A COUNT HOLDS THE RACK: the list says which count, and the approval is refused naming it, until the count is cancelled
// (a-lock-stops-sales-and-cancels-too).
func TestFoundRequestApprove_ACountedRackIsRefusedNamingTheCount(t *testing.T) {
	f := opnameStocked(t)
	r := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakA, 1)
	s := countKaosHitam(t, f)

	listed := f.foundList(t, opAdmin(opBudi), inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_WAITING)
	if len(listed) != 1 || listed[0].GetBlock() != inventoryv1.FoundRequestApproveBlock_FOUND_REQUEST_APPROVE_BLOCK_BEING_COUNTED ||
		listed[0].GetCountingSessionId() != s.GetId() {
		t.Fatalf("listed %+v, want BEING_COUNTED by count #%d", listed, s.GetId())
	}

	before := txCount(t, f.db)

	_, err := f.approve(opAdmin(opBudi), r.GetId())
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "count #") {
		t.Fatalf("approving on a counted rack: err = %v, want FailedPrecondition naming the count", err)
	}

	if after := txCount(t, f.db); after != before {
		t.Fatalf("a refused approval wrote %d transaction(s)", after-before)
	}

	cancelCount(t, f, s.GetId())

	_, err = f.approve(opAdmin(opBudi), r.GetId())
	if err != nil {
		t.Fatalf("approving after the count was cancelled: %v", err)
	}
}

// ONLY A WAITING REQUEST IS DECIDED: approved twice, approved after a rejection or a withdrawal — refused, posting nothing.
func TestFoundRequestApprove_NotWaitingIsRefused(t *testing.T) {
	f := opnameStocked(t)
	approved := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakA, 1)
	withdrawn := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakB, 1)

	_, err := f.approve(opAdmin(opBudi), approved.GetId())
	if err != nil {
		t.Fatalf("approve: %v", err)
	}

	before := txCount(t, f.db)

	_, err = f.approve(opOwner(opDewi), approved.GetId())
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("approved twice: err = %v, want FailedPrecondition", err)
	}

	_, err = f.reject(opStaff(opAni), withdrawn.GetId(), "miscounted — it was on Rak A")
	if err != nil {
		t.Fatalf("withdraw: %v", err)
	}

	_, err = f.approve(opAdmin(opBudi), withdrawn.GetId())
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("approving a withdrawn request: err = %v, want FailedPrecondition", err)
	}

	if after := txCount(t, f.db); after != before {
		t.Fatalf("the refused approvals wrote %d transaction(s)", after-before)
	}

	_, err = f.approve(opAdmin(opBudi), 999999)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("an unknown request: err = %v, want NotFound", err)
	}
}

// THE SAME FOUND, WHICHEVER DOOR (an-adjust-found-waits-for-the-owner-or-admin): from one state — a unit of batch 2
// lost — three Kaos Hitam turn up on Rak B. Approving a found request posts exactly what a stock count that finds them
// posts: the same claim into the same batch at the same price, the same mint, the same rack, the same money.
func TestFoundRequestApprove_PostsWhatACountsFoundPosts(t *testing.T) {
	f := opnameStocked(t)
	f.lostOne(t, batchesOf(t, f, otKaosHitam)[1], f.rakB, 1)

	type posted struct {
		claims     map[uint64]int64
		itemQty    int64
		itemTotal  float64
		mintCount  int64
		mintPrice  float64
		mintValue  float64
		batches    []int64
		rackB      int64
		foundMoney int64
		expenses   int
	}

	read := func(txID uint64) posted {
		var p posted

		p.claims = map[uint64]int64{}

		var claims []models.ProblemClaimedTransaction
		f.db.Where("transaction_id = ?", txID).Find(&claims)

		for _, c := range claims {
			p.claims[c.ProblemID] += c.ClaimedStockCount
		}

		f.db.Raw(`SELECT COALESCE(SUM(quantity), 0) FROM inventory_transaction_items WHERE transaction_id = ?`, txID).Scan(&p.itemQty)
		f.db.Raw(`SELECT COALESCE(SUM(total), 0) FROM inventory_transaction_items WHERE transaction_id = ?`, txID).Scan(&p.itemTotal)

		var minted []models.Batch
		f.db.Where("transaction_id = ?", txID).Find(&minted)

		for _, b := range minted {
			p.mintCount += b.InitStockCount
			p.mintPrice = b.PriceUnit
			p.mintValue += b.InitStockValuation
		}

		for _, b := range batchesOf(t, f, otKaosHitam) {
			if b.TransactionID != txID {
				p.batches = append(p.batches, b.StockCount)
			}
		}

		p.rackB = rackCount(t, f.db, otKaosHitam, f.rakB)

		for _, d := range f.poster.damaged {
			if d.kind == inventory_v1.StockDamageFound {
				p.foundMoney += d.amount
			}
		}

		p.expenses = len(f.expense.posted)

		return p
	}

	f.poster.damaged = nil
	f.expense.posted = nil

	var byRequest, byCount posted

	inSavepoint(t, f.db, "by_request", func() {
		r := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakB, 3)

		res, err := f.approve(opAdmin(opBudi), r.GetId())
		if err != nil {
			t.Fatalf("approve: %v", err)
		}

		byRequest = read(res.GetTransactionId())
	})

	f.poster.damaged = nil
	f.expense.posted = nil

	inSavepoint(t, f.db, "by_count", func() {
		s := countKaosHitam(t, f)
		f.countRow(t, opDodi, s.GetId(), otKaosHitam, f.rakA, 5, 0)
		f.countRow(t, opDodi, s.GetId(), otKaosHitam, f.rakB, 4+3, 0)

		res, err := f.finalize(opAdmin(opBudi), s.GetId())
		if err != nil {
			t.Fatalf("finalize: %v", err)
		}

		if got := txTypesOf(res); len(got) != 1 || got[0] != inventoryv1.OpnameTransactionType_OPNAME_TRANSACTION_TYPE_FOUND {
			t.Fatalf("the count posted %v, want one found", got)
		}

		byCount = read(res.GetTransactions()[0].GetTransactionId())
	})

	if len(byRequest.claims) != 1 || len(byCount.claims) != 1 {
		t.Fatalf("claims %v by request, %v by count — want the one loss each", byRequest.claims, byCount.claims)
	}

	for problem, n := range byRequest.claims {
		if byCount.claims[problem] != n {
			t.Fatalf("claims %v by request, %v by count", byRequest.claims, byCount.claims)
		}
	}

	if byRequest.itemQty != byCount.itemQty || !san_money.Equal(byRequest.itemTotal, byCount.itemTotal) ||
		byRequest.mintCount != byCount.mintCount || !san_money.Equal(byRequest.mintPrice, byCount.mintPrice) ||
		!san_money.Equal(byRequest.mintValue, byCount.mintValue) || byRequest.rackB != byCount.rackB ||
		byRequest.foundMoney != byCount.foundMoney || byRequest.expenses != byCount.expenses ||
		len(byRequest.batches) != len(byCount.batches) {
		t.Fatalf("by request %+v\nby count   %+v\nwant the same postings", byRequest, byCount)
	}

	for i := range byRequest.batches {
		if byRequest.batches[i] != byCount.batches[i] {
			t.Fatalf("batches %v by request, %v by count", byRequest.batches, byCount.batches)
		}
	}

	if byRequest.foundMoney != 12000 || byRequest.mintCount != 2 || byRequest.rackB != 7 {
		t.Fatalf("by request %+v, want Rp 12.000 claimed back, 2 minted, Rak B at 7", byRequest)
	}
}

// THE BACKSTOP: a request the report would have refused today — a product its team never had here — posts nothing and
// is refused if it ever waits (a-found-never-stocked-here-is-refused-at-the-report).
func TestFoundRequestApprove_NoPriceIsRefusedPostingNothing(t *testing.T) {
	f := opnameStocked(t)

	row := models.FoundRequest{
		WarehouseID: otWarehouse, TeamID: otSinar, ProductID: opKaosUngu, PlacementID: f.rakC, StockCount: 1,
		ReportedByID: opAni, Status: models.FoundWaiting,
	}

	err := f.db.Create(&row).Error
	if err != nil {
		t.Fatalf("seed a request: %v", err)
	}

	before := txCount(t, f.db)

	_, err = f.approve(opAdmin(opBudi), row.ID)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("approving with no price here: err = %v, want FailedPrecondition", err)
	}

	if after := txCount(t, f.db); after != before {
		t.Fatalf("a refused approval wrote %d transaction(s)", after-before)
	}

	if got := foundRow(t, f.db, row.ID); got.Status != models.FoundWaiting {
		t.Fatalf("status %q, want still waiting", got.Status)
	}
}

// ROOT APPROVES AS AN OVERRIDE (root-finalizes-only-as-an-override, by the same rule): allowed, and the found
// transaction is stamped.
func TestFoundRequestApprove_RootIsStampedAsAnOverride(t *testing.T) {
	f := opnameStocked(t)
	r := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakA, 1)

	_, err := f.approve(opRootCtx(), r.GetId())
	if err != nil {
		t.Fatalf("Root approving: %v", err)
	}

	actor, override := lastTransactionOverride(t, f.db, string(models.TxFound))
	if actor != opRoot || !override {
		t.Fatalf("found transaction by %d, override %v — want Root, stamped", actor, override)
	}
}
