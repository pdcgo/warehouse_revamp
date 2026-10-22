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

	if got.reversal() {
		t.Fatal("a shortfall was posted as a reversal — that credits the warehouse for losing things")
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
	svc := newServiceWithLiability(t, db, &realPoster{liability: liability_v1.NewService(db, nil, nil)})

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

	var entry liability_service_models.LiabilityLog

	err = db.
		Where("team_id = ? AND counterparty_id = ?", damageOwnerTeam, warehouse).
		Take(&entry).
		Error
	if err != nil {
		t.Fatalf("read the entry: %v", err)
	}

	// ⚠ `lost_good`, NOT `stock_damage`. An opname shortfall is stock that is GONE rather than broken,
	// and the-ledger-speaks-the-business-words gave the two their own names.
	if entry.SourceType != "lost_good" {
		t.Fatalf("entry source = %q, want lost_good", entry.SourceType)
	}
}
