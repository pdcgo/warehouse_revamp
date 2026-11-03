package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// The team `acceptOne` raises its restock as — so the batches it mints are owned by team 2, and team 2
// is who the warehouse owes when it breaks them.
const damageOwnerTeam uint64 = 2

// damageFixture stands a warehouse up with one shelf and one batch of 100 units at 40.000 each, and
// returns the ids an adjust needs.
func damageFixture(
	t *testing.T,
	db *gorm.DB,
	svc *inventory_v1.Service,
	warehouse uint64,
) (rackID, batchID, product uint64) {
	t.Helper()

	ctx := ctxUser(1)
	product = 100

	rack, err := svc.RackCreate(ctx,
		connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}

	rackID = rack.Msg.GetRack().GetId()

	acceptOne(t, svc, warehouse, rackID, product, 100, 4000000) // 40.000/pc, no freight

	batches, err := svc.BatchList(ctx, connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: warehouse,
		Filter: &inventoryv1.BatchListFilter{ProductId: product},
		Page:   page1(),
	}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}

	return rackID, batchRows(batches.Msg)[0].GetId(), product
}

func adjustBatch(
	t *testing.T,
	svc *inventory_v1.Service,
	warehouse, product, rackID, batchID uint64,
	reason inventoryv1.StockAdjustReason,
	qty int64,
) {
	t.Helper()

	_, err := svc.StockAdjust(context.Background(), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouse,
		ProductId:   product,
		Place:       &inventoryv1.StockAdjustRequest_RackId{RackId: rackID},
		ReasonType:  reason,
		BatchId:     batchID,
		Quantity:    qty,
		Reason:      "shift check",
	}))
	if err != nil {
		t.Fatalf("adjust %v: %v", reason, err)
	}
}

// ⚠ THE DIRECTION IS THE WHOLE POINT (business_level §Warehouse 5). The goods were never the
// warehouse's — it holds them, the selling team owns them — so breaking them makes the WAREHOUSE the
// debtor. Getting this backwards would charge the team whose stock was destroyed.
func TestStockAdjust_DamageMakesTheWarehouseOweTheOwner(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithLiability(t, db, poster)

	const warehouse uint64 = 5

	rackID, batchID, product := damageFixture(t, db, svc, warehouse)

	adjustBatch(t, svc, warehouse, product, rackID, batchID,
		inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_DAMAGED, 5)

	if len(poster.damaged) != 1 {
		t.Fatalf("%d damage debts posted, want 1", len(poster.damaged))
	}

	got := poster.damaged[0]

	if got.warehouseID != warehouse || got.ownerTeamID != damageOwnerTeam {
		t.Fatalf("posted warehouse %d owes owner %d, want %d owes %d — the direction is the point",
			got.warehouseID, got.ownerTeamID, warehouse, damageOwnerTeam)
	}

	// 5 units at the batch's frozen 40.000.
	if got.amount != 200000 {
		t.Fatalf("amount = %d, want 200000 (5 × the batch's frozen 40.000)", got.amount)
	}

	if got.reversal() {
		t.Fatal("a damage was posted as a reversal — that credits the warehouse for breaking things")
	}
}

// LOST IS THE SAME OBLIGATION AS DAMAGED. The goods are equally gone; only the story differs.
func TestStockAdjust_LostReimbursesToo(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithLiability(t, db, poster)

	const warehouse uint64 = 5

	rackID, batchID, product := damageFixture(t, db, svc, warehouse)

	adjustBatch(t, svc, warehouse, product, rackID, batchID,
		inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_LOST, 3)

	if len(poster.damaged) != 1 || poster.damaged[0].amount != 120000 {
		t.Fatalf("lost posted %+v, want one debt of 120000", poster.damaged)
	}
}

// damageFacts says product 100 is team 2's — the team acceptOne restocks as — so a found's request names the owner whose
// loss it claims back.
func damageFacts() fakeFacts {
	return fakeFacts{100: {TeamID: damageOwnerTeam, ProductCode: "KH-01", Name: "Kaos"}}
}

// approveFound reports n units found on the rack — the one door, FoundRequestCreate — and has another person approve
// them (an-adjust-found-waits-for-the-owner-or-admin).
func approveFound(t *testing.T, svc *inventory_v1.Service, warehouse, product, rackID uint64, n int64) uint64 {
	t.Helper()

	reported, err := svc.FoundRequestCreate(ctxAs(41, warehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF),
		connect.NewRequest(&inventoryv1.FoundRequestCreateRequest{TeamId: warehouse, ProductId: product, RackId: rackID, Quantity: n}))
	if err != nil {
		t.Fatalf("report a found: %v", err)
	}

	approved, err := svc.FoundRequestApprove(ctxAs(43, warehouse, role_basev1.Role_ROLE_WAREHOUSE_ADMIN),
		connect.NewRequest(&inventoryv1.FoundRequestApproveRequest{TeamId: warehouse, FoundRequestId: reported.Msg.GetFoundRequest().GetId()}))
	if err != nil {
		t.Fatalf("approve the found: %v", err)
	}

	return approved.Msg.GetTransactionId()
}

// ⚠ A FOUND GIVES THE REIMBURSEMENT BACK (balance_context 5) — as a REVERSAL, never by deleting the entry that charged
// it. The history has to read as one story: reimbursed, then given back. The found waits for approval and its approval
// claims the loss (an-adjust-found-waits-for-the-owner-or-admin).
func TestStockAdjust_AFoundGivesTheReimbursementBack(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := inventory_v1.NewService(db, poster, nil, nil, nil, damageFacts())

	const warehouse uint64 = 5

	rackID, batchID, product := damageFixture(t, db, svc, warehouse)

	adjustBatch(t, svc, warehouse, product, rackID, batchID,
		inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_LOST, 5)
	approveFound(t, svc, warehouse, product, rackID, 5)

	if len(poster.damaged) != 2 {
		t.Fatalf("%d postings, want 2 — the find did not give the reimbursement back", len(poster.damaged))
	}

	found := poster.damaged[1]

	if !found.reversal() {
		t.Fatal("the find was posted as a NEW debt rather than a reversal — the warehouse now owes twice")
	}

	if found.amount != poster.damaged[0].amount {
		t.Fatalf("the reversal is %d against a debt of %d — they must cancel",
			found.amount, poster.damaged[0].amount)
	}

	// ⚠ Different transactions, so the ledger's idempotency key differs and BOTH can post. Keying the
	// reversal on the loss's own transaction would collide with it.
	if found.movementID == poster.damaged[0].movementID {
		t.Fatal("the find reused the loss's transaction id — one of the two entries cannot exist")
	}
}

// ⚠ THE SOURCE IS THE MOVEMENT, which is what makes a retried adjust harmless: every adjust writes
// exactly one movement, so the ledger's unique index refuses the second posting of the same one.
func TestStockAdjust_DamageIsKeyedOnItsMovement(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithLiability(t, db, poster)

	const warehouse uint64 = 5

	rackID, batchID, product := damageFixture(t, db, svc, warehouse)

	res, err := svc.StockAdjust(context.Background(), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouse,
		ProductId:   product,
		Place:       &inventoryv1.StockAdjustRequest_RackId{RackId: rackID},
		ReasonType:  inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_DAMAGED,
		BatchId:     batchID,
		Quantity:    5,
		Reason:      "dropped",
	}))
	if err != nil {
		t.Fatalf("adjust: %v", err)
	}

	if got := poster.damaged[0].movementID; got != res.Msg.GetMovement().GetId() {
		t.Fatalf("source id = %d, want the adjust movement %d", got, res.Msg.GetMovement().GetId())
	}
}

// recount corrects the fixture's rack TO a counted figure — the RECOUNT reason, no batch named.
func recount(t *testing.T, svc *inventory_v1.Service, warehouse, product, rackID uint64, onHand int64) *inventoryv1.StockAdjustResponse {
	t.Helper()

	res, err := svc.StockAdjust(context.Background(), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouse,
		ProductId:   product,
		Place:       &inventoryv1.StockAdjustRequest_RackId{RackId: rackID},
		ReasonType:  inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_RECOUNT,
		OnHand:      onHand,
		Reason:      "shelf recount",
	}))
	if err != nil {
		t.Fatalf("recount: %v", err)
	}

	return res.Msg
}

// A RECOUNT SHORTFALL IS OWED (a-recount-shortfall-is-written-off-and-owed). The rack held 100 and the count says 95:
// the 5 missing units left the owner's batch at its 40.000, so the warehouse owes the owner 200.000 — as a LOST unit,
// keyed by the adjustment. Recording the loss as a recount no longer avoids the charge.
func TestStockAdjust_ARecountShortfallIsOwed(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithLiability(t, db, poster)

	const warehouse uint64 = 5

	rackID, _, product := damageFixture(t, db, svc, warehouse)

	res := recount(t, svc, warehouse, product, rackID, 95)

	if len(poster.damaged) != 1 {
		t.Fatalf("a recount shortfall posted %d debts, want 1", len(poster.damaged))
	}

	got := poster.damaged[0]

	if got.warehouseID != warehouse || got.ownerTeamID != damageOwnerTeam || got.amount != 200000 {
		t.Fatalf("posted %+v, want warehouse %d owing owner %d 200000", got, warehouse, damageOwnerTeam)
	}

	if got.kind != inventory_v1.StockDamageLost {
		t.Fatalf("kind = %v, want lost — a recount shortfall is shrinkage", got.kind)
	}

	if got.movementID != res.GetMovement().GetId() {
		t.Fatalf("source id = %d, want the adjustment %d", got.movementID, res.GetMovement().GetId())
	}
}

// A SURPLUS AND AN EXACT COUNT MOVE NO MONEY — only a shortfall is a loss.
func TestStockAdjust_ARecountSurplusOwesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithLiability(t, db, poster)

	const warehouse uint64 = 5

	rackID, _, product := damageFixture(t, db, svc, warehouse)

	recount(t, svc, warehouse, product, rackID, 100)
	recount(t, svc, warehouse, product, rackID, 104)

	if len(poster.damaged) != 0 {
		t.Fatalf("an exact count and a surplus posted %+v, want no debt", poster.damaged)
	}
}

// A WAREHOUSE RECOUNTING ITS OWN GOODS owes nobody — its shortfall is its own loss, written off, never a debt to itself.
func TestStockAdjust_ARecountOfTheWarehousesOwnGoodsOwesNobody(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithLiability(t, db, poster)

	// acceptOne raises the restock as team 2, so making the warehouse team 2 makes it its own owner.
	const warehouse uint64 = damageOwnerTeam

	rackID, _, product := damageFixture(t, db, svc, warehouse)

	recount(t, svc, warehouse, product, rackID, 90)

	if len(poster.damaged) != 0 {
		t.Fatalf("a warehouse recounting its OWN goods posted %+v, want no debt", poster.damaged)
	}
}

// A TEAM CANNOT OWE ITSELF. A warehouse that raised its own restock owns the goods it holds, so
// breaking them is its own loss and there is nobody to reimburse — the ledger would refuse the
// posting anyway, and failing an honest stock correction over it would be the wrong outcome.
func TestStockAdjust_NoDebtWhenTheWarehouseOwnsTheGoods(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithLiability(t, db, poster)

	// acceptOne raises the restock as team 2, so making the warehouse team 2 makes it its own owner.
	const warehouse uint64 = damageOwnerTeam

	rackID, batchID, product := damageFixture(t, db, svc, warehouse)

	adjustBatch(t, svc, warehouse, product, rackID, batchID,
		inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_DAMAGED, 5)

	if len(poster.damaged) != 0 {
		t.Fatalf("a warehouse breaking its OWN goods posted %+v, want no debt", poster.damaged)
	}
}

// ── The whole chain, against the real ledger ────────────────────────────────────────────────────
//
// The tests above prove inventory's half with a fake. This one wires the REAL liability service
// through the same adapter shape the composition root uses, so the assertion is about rows in
// `liability_balances` rather than about a call being made — and about the SIGN, which is the one
// thing a fake can agree with while production has it backwards.
func TestStockAdjust_DamageMovesTheRealLedger(t *testing.T) {
	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, &realPoster{liability: liability_v1.NewService(db, nil, nil, nil)}, nil, nil, nil,
		damageFacts())

	const warehouse uint64 = 5

	rackID, batchID, product := damageFixture(t, db, svc, warehouse)

	adjustBatch(t, svc, warehouse, product, rackID, batchID,
		inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_DAMAGED, 5)

	// THE OWNER IS OWED: positive on its side. If this ever reads -200000 the warehouse has billed the
	// team whose stock it destroyed.
	var ownerBalance liability_service_models.LiabilityBalance

	err := db.
		Where("team_id = ? AND counterparty_id = ?", damageOwnerTeam, warehouse).
		Take(&ownerBalance).
		Error
	if err != nil {
		t.Fatalf("read the owner's balance: %v", err)
	}

	if ownerBalance.Balance != 200000 {
		t.Fatalf("the owner is owed %d, want +200000 — a negative here means the victim was charged",
			ownerBalance.Balance)
	}

	// And the entry says WHY, by id.
	var entry liability_service_models.LiabilityLog

	err = db.
		Where("team_id = ? AND counterparty_id = ?", damageOwnerTeam, warehouse).
		Take(&entry).
		Error
	if err != nil {
		t.Fatalf("read the entry: %v", err)
	}

	// ⚠ `broken_good`, NOT `stock_damage`. the-ledger-speaks-the-business-words split one source type
	// into three, so the ledger now says WHICH loss this was instead of leaving it to a boolean.
	if entry.SourceType != "broken_good" {
		t.Fatalf("entry source = %q, want broken_good", entry.SourceType)
	}

	// A BROKEN UNIT IS THROWN AWAY (a-broken-unit-is-thrown-away) — only a LOST one comes back. Five more go missing,
	// then turn up: the found's approval claims the loss and squares THAT debt; the broken one stays owed.
	adjustBatch(t, svc, warehouse, product, rackID, batchID,
		inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_LOST, 5)
	approveFound(t, svc, warehouse, product, rackID, 5)

	err = db.
		Where("team_id = ? AND counterparty_id = ?", damageOwnerTeam, warehouse).
		Take(&ownerBalance).
		Error
	if err != nil {
		t.Fatalf("re-read the owner's balance: %v", err)
	}

	if ownerBalance.Balance != 200000 {
		t.Fatalf("balance = %d after the lost goods turned up, want 200000 — the broken ones are still owed", ownerBalance.Balance)
	}

	// EVERY ENTRY REMAINS, each under its own source type: the breakage `broken_good`, the loss `lost_good`, the find
	// `found`. Counting them separately is a STRONGER check than the old `stock_damage = 2` — that count could have been
	// satisfied by two losses and no find at all.
	for _, want := range []struct {
		sourceType string
		count      int64
	}{
		{"broken_good", 1},
		{"lost_good", 1},
		{"found", 1},
	} {
		var entries int64

		err = db.Model(&liability_service_models.LiabilityLog{}).
			Where("team_id = ? AND counterparty_id = ? AND source_type = ?",
				damageOwnerTeam, warehouse, want.sourceType).
			Count(&entries).Error
		if err != nil {
			t.Fatalf("count %s entries: %v", want.sourceType, err)
		}

		if entries != want.count {
			t.Fatalf("%d %s entries, want %d — the reimbursement was edited rather than "+
				"compensated", entries, want.sourceType, want.count)
		}
	}
}
