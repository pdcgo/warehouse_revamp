package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// countShelf counts one product on one rack to `counted`.
func countShelf(
	t *testing.T,
	svc *inventory_v1.Service,
	warehouse, rackID, product uint64,
	counted int64,
) *inventoryv1.StockOpnameResponse {
	t.Helper()

	res, err := svc.StockOpname(ctxUser(1), connect.NewRequest(&inventoryv1.StockOpnameRequest{
		WarehouseId: warehouse,
		Place:       &inventoryv1.StockPlace{Place: &inventoryv1.StockPlace_RackId{RackId: rackID}},
		Lines:       []*inventoryv1.StockOpnameLine{{ProductId: product, CountedQty: counted}},
		Note:        "monthly count",
	}))
	if err != nil {
		t.Fatalf("StockOpname: %v", err)
	}

	return res.Msg
}

// ⚠ THE ASYMMETRY THIS CLOSES (owner, 2026-08-20). Before this, the same physical loss reimbursed the
// owner or did not depending on which RPC noticed it: a LOST adjust paid, a shelf count did not.
// business_level §Warehouse 5 says EVERY broken or lost in the warehouse is reimbursed, and §7 makes
// counting the shelf the warehouse's own job.
func TestStockOpname_ShortfallReimbursesTheOwner(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithLiability(t, db, poster)

	const warehouse uint64 = 5

	rackID, _, product := damageFixture(t, db, svc, warehouse)

	// 100 on the books, 95 on the shelf — 5 missing at the batch's frozen 40.000.
	countShelf(t, svc, warehouse, rackID, product, 95)

	if len(poster.damaged) != 1 {
		t.Fatalf("%d reimbursements posted, want 1 — a counted shortfall paid nobody", len(poster.damaged))
	}

	got := poster.damaged[0]

	if got.warehouseID != warehouse || got.ownerTeamID != damageOwnerTeam {
		t.Fatalf("posted warehouse %d owes owner %d, want %d owes %d",
			got.warehouseID, got.ownerTeamID, warehouse, damageOwnerTeam)
	}

	if got.amount != 200000 {
		t.Fatalf("amount = %d, want 200000 (5 × 40.000)", got.amount)
	}

	if got.reversal {
		t.Fatal("a shortfall was posted as a reversal — that credits the warehouse for losing things")
	}
}

// ⚠ ONE SHORTFALL CAN SPAN SEVERAL OWNERS, and each must be paid what THEIR units were worth. A shelf
// holds whatever restocks filled it — collapsing the draw into one number would pay the first team and
// leave the second with nothing.
func TestStockOpname_ShortfallSplitsAcrossOwners(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithLiability(t, db, poster)

	const warehouse uint64 = 5
	const product uint64 = 100

	rack, err := svc.RackCreate(ctxUser(1),
		connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}

	rackID := rack.Msg.GetRack().GetId()

	// Two layers of the SAME product on one shelf, owned by different teams and priced differently.
	// The older (team 2) is drawn first, so a shortfall of 15 takes all 10 of theirs and 5 of team 7's.
	acceptOneFor(t, svc, 2, warehouse, rackID, product, 10, 400000)  // 40.000/pc
	acceptOneFor(t, svc, 7, warehouse, rackID, product, 20, 1400000) // 70.000/pc

	countShelf(t, svc, warehouse, rackID, product, 15)

	if len(poster.damaged) != 2 {
		t.Fatalf("%d reimbursements, want 2 — one owner was not paid", len(poster.damaged))
	}

	paid := map[uint64]int64{}
	for _, d := range poster.damaged {
		paid[d.ownerTeamID] = d.amount
	}

	// FIFO: all 10 of team 2's at 40.000, then 5 of team 7's at 70.000.
	if paid[2] != 400000 {
		t.Fatalf("owner 2 paid %d, want 400000 (10 × 40.000)", paid[2])
	}

	if paid[7] != 350000 {
		t.Fatalf("owner 7 paid %d, want 350000 (5 × 70.000)", paid[7])
	}
}

// A SURPLUS REIMBURSES NOBODY, and is not a reversal either: stock that turns up on a count was never
// established as lost, so there is no debt of its own to give back.
func TestStockOpname_SurplusReimbursesNobody(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithLiability(t, db, poster)

	const warehouse uint64 = 5

	rackID, _, product := damageFixture(t, db, svc, warehouse)

	countShelf(t, svc, warehouse, rackID, product, 105)

	if len(poster.damaged) != 0 {
		t.Fatalf("a surplus posted %+v, want nothing", poster.damaged)
	}
}

// AN EXACT COUNT IS NOT A LOSS. The commonest outcome of a stock-take must move no money.
func TestStockOpname_ExactCountReimbursesNobody(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithLiability(t, db, poster)

	const warehouse uint64 = 5

	rackID, _, product := damageFixture(t, db, svc, warehouse)

	countShelf(t, svc, warehouse, rackID, product, 100)

	if len(poster.damaged) != 0 {
		t.Fatalf("a correct count posted %+v, want nothing", poster.damaged)
	}
}

// ⚠ AN UNKNOWN COST REIMBURSES NOTHING (#74), the same rule the adjust path follows — and the count
// still corrects the shelf. A zero entry would consume the pair's idempotency key for that movement.
func TestStockOpname_UnknownCostReimbursesNobody(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithLiability(t, db, poster)

	const warehouse uint64 = 5

	rackID, batchID, product := damageFixture(t, db, svc, warehouse)

	err := db.Exec(`UPDATE stock_batches SET unit_cost = NULL WHERE id = ?`, batchID).Error
	if err != nil {
		t.Fatalf("blank the cost: %v", err)
	}

	msg := countShelf(t, svc, warehouse, rackID, product, 95)

	if len(poster.damaged) != 0 {
		t.Fatalf("an unknown-cost shortfall posted %+v, want nothing", poster.damaged)
	}

	// And the count says so, rather than reporting a loss of zero as if it were priced.
	if msg.GetValueKnown() {
		t.Fatal("value_known = true for a shortfall nobody could price")
	}
}

// A TEAM CANNOT OWE ITSELF — a warehouse counting its own goods short has nobody to reimburse.
func TestStockOpname_NoDebtWhenTheWarehouseOwnsTheGoods(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithLiability(t, db, poster)

	const warehouse uint64 = damageOwnerTeam

	rackID, _, product := damageFixture(t, db, svc, warehouse)

	countShelf(t, svc, warehouse, rackID, product, 95)

	if len(poster.damaged) != 0 {
		t.Fatalf("a warehouse losing its OWN goods posted %+v, want nothing", poster.damaged)
	}
}

// ── Against the real ledger ─────────────────────────────────────────────────────────────────────
//
// The SIGN is the thing a fake will happily agree with while production has it backwards, so the
// balance is read rather than the call inspected.
func TestStockOpname_ShortfallMovesTheRealLedger(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithLiability(t, db, &realPoster{liability: liability_v1.NewService(db)})

	const warehouse uint64 = 5

	rackID, _, product := damageFixture(t, db, svc, warehouse)

	countShelf(t, svc, warehouse, rackID, product, 95)

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

	var entry liability_service_models.LiabilityEntry

	err = db.
		Where("team_id = ? AND counterparty_id = ?", damageOwnerTeam, warehouse).
		Take(&entry).
		Error
	if err != nil {
		t.Fatalf("read the entry: %v", err)
	}

	if entry.SourceType != "stock_damage" {
		t.Fatalf("entry source = %q, want stock_damage", entry.SourceType)
	}
}

// acceptOneFor is acceptOne with the REQUESTING TEAM spelled out, so a test can put two owners'
// layers on one shelf. acceptOne hardcodes team 2, which is right for every other test here.
func acceptOneFor(
	t *testing.T,
	svc *inventory_v1.Service,
	team, warehouse, rackID, product uint64,
	qty, total int64,
) {
	t.Helper()

	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: team, WarehouseId: warehouse, ShippingCode: "jne",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: product, Sku: "SKU", Name: "P", Quantity: qty, TotalPrice: total},
		},
	}))
	if err != nil {
		t.Fatalf("create for team %d: %v", team, err)
	}

	item := created.Msg.GetRequest().GetItems()[0]

	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: created.Msg.GetRequest().GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId:           item.GetId(),
			ReceivedQuantity: qty,
			Placements: []*inventoryv1.RestockPlacement{{
				Place:    &inventoryv1.RestockPlacement_RackId{RackId: rackID},
				Quantity: qty,
			}},
		}},
	}))
	if err != nil {
		t.Fatalf("fulfil for team %d: %v", team, err)
	}
}
