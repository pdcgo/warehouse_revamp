package inventory_v1_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// REPORTING A FOUND (an-adjust-found-waits-for-the-owner-or-admin, staff-may-report-a-found): FoundRequestCreate is the
// one door, staff report too, and a report posts NOTHING — no transaction, no batch, no rack row, no money — until the
// Owner or Admin approves it.

func TestFoundRequestCreate_StaffReportAndNothingPosts(t *testing.T) {
	f := opnameStocked(t)
	before := txCount(t, f.db)

	r, err := f.report(opStaff(opAni), otKaosHitam, f.rakC, 2, "  two on the top shelf  ")
	if err != nil {
		t.Fatalf("staff report: %v", err)
	}

	if r.GetStatus() != inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_WAITING || r.GetTeamId() != otMelati ||
		r.GetReportedById() != opAni || r.GetStockCount() != 2 || r.GetRackCode() != "rak-c" ||
		r.GetProductCode() != "KH-01" || r.GetProductName() != "Kaos Hitam" || r.GetNote() != "two on the top shelf" {
		t.Fatalf("request %+v, want Melati's Kaos Hitam ×2 on rak-c, waiting, by Ani, the note trimmed", r)
	}

	// What approving would post now: nothing to claim, so 2 minted at the team's newest price here, Rp 12.000.
	if lines := r.GetLines(); len(lines) != 1 || lines[0].GetType() != inventoryv1.FoundRequestPostType_FOUND_REQUEST_POST_TYPE_MINT ||
		lines[0].GetStockCount() != 2 || !san_money.Equal(lines[0].GetPriceUnit(), 12000) || !san_money.Equal(r.GetMintedAmount(), 24000) {
		t.Fatalf("lines %+v, want one mint of 2 at Rp 12.000", lines)
	}

	// Staff never approve; Ani reported it.
	if r.GetBlock() != inventoryv1.FoundRequestApproveBlock_FOUND_REQUEST_APPROVE_BLOCK_OWN_REPORT {
		t.Fatalf("block %v, want OWN_REPORT for the reporter", r.GetBlock())
	}

	if after := txCount(t, f.db); after != before {
		t.Fatalf("a report wrote %d transaction(s), want none", after-before)
	}

	if n := rackCount(t, f.db, otKaosHitam, f.rakC); n != 0 {
		t.Fatalf("Rak C holds %d Kaos Hitam after a report, want 0 — nothing moves until approved", n)
	}

	var rackRows int64
	f.db.Model(&models.ProductPlacement{}).Where("product_id = ? AND placement_id = ?", otKaosHitam, f.rakC).Count(&rackRows)
	if rackRows != 0 {
		t.Fatalf("a report created %d rack row(s), want none", rackRows)
	}

	if len(f.poster.damaged) != 0 || len(f.expense.posted) != 0 {
		t.Fatalf("a report moved money: %+v, %+v", f.poster.damaged, f.expense.posted)
	}

	if ledgersAgree(t, f.db, otKaosHitam) != 10 {
		t.Fatalf("Kaos Hitam changed with a report")
	}
}

// A COUNTED RACK REFUSES THE REPORT, naming the count (a-lock-stops-sales-and-cancels-too); a rack the count does not
// hold takes it.
func TestFoundRequestCreate_ACountedRackIsRefusedNamingTheCount(t *testing.T) {
	f := opnameStocked(t)
	s := countKaosHitam(t, f)

	_, err := f.report(opStaff(opAni), otKaosHitam, f.rakA, 1, "")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "count #") {
		t.Fatalf("a report on a counted rack: err = %v, want FailedPrecondition naming the count", err)
	}

	// Rak C has no Kaos Hitam row, so the product count does not hold it.
	f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakC, 1)

	cancelCount(t, f, s.GetId())
	f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakA, 1)
}

// A PRODUCT ITS TEAM NEVER HAD HERE IS REFUSED AT THE REPORT (a-found-never-stocked-here-is-refused-at-the-report) — by
// the test last-price-is-the-teams-newest-batch-here uses, so it names the product and says how it comes in. A product
// stocked here before and at 0 now has a price, and is accepted.
func TestFoundRequestCreate_NeverStockedHereIsRefusedEmptiedIsNot(t *testing.T) {
	f := opnameStocked(t)

	_, err := f.report(opStaff(opAni), opKaosUngu, f.rakC, 1, "")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "Kaos Ungu (KU-01) was never stocked here") ||
		!strings.Contains(err.Error(), "bring it in by restock") {
		t.Fatalf("a never-stocked product: err = %v, want FailedPrecondition naming it", err)
	}

	// Every Kaos Polos lost: its batch is at 0, and still its price.
	polos := batchesOf(t, f, otKaosPolos)[0]
	f.lostOne(t, polos, f.rakA, 4)

	r := f.mustReport(t, opStaff(opAni), otKaosPolos, f.rakA, 1)
	if lines := r.GetLines(); len(lines) != 1 || lines[0].GetType() != inventoryv1.FoundRequestPostType_FOUND_REQUEST_POST_TYPE_CLAIM ||
		!san_money.Equal(lines[0].GetPriceUnit(), 20000) {
		t.Fatalf("lines %+v, want one claim of the loss at Rp 20.000", lines)
	}
}

// Another warehouse's rack and a product that exists nowhere read as NotFound; a report names a positive quantity.
func TestFoundRequestCreate_RefusesWhatIsNotHere(t *testing.T) {
	f := opnameStocked(t)
	elsewhere := newRack(t, f.svc, 77, "rak-x")

	_, err := f.report(opStaff(opAni), otKaosHitam, elsewhere, 1, "")
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("another warehouse's rack: err = %v, want NotFound", err)
	}

	_, err = f.report(opStaff(opAni), 999999, f.rakA, 1, "")
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("an unknown product: err = %v, want NotFound", err)
	}

	_, err = f.report(opStaff(opAni), otKaosHitam, f.rakA, 0, "")
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("zero units: err = %v, want InvalidArgument", err)
	}
}
