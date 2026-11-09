package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// REJECTING A FOUND (an-adjust-found-waits-for-the-owner-or-admin): a reason is required — the reporter reads it — and
// nothing posts. The reporter may reject — withdraw — their own, staff included (the-reporter-may-withdraw-their-found);
// staff may not reject another's.

func TestFoundRequestReject_NeedsAReasonAndPostsNothing(t *testing.T) {
	f := opnameStocked(t)
	r := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakA, 2)
	before := txCount(t, f.db)

	_, err := f.reject(opAdmin(opBudi), r.GetId(), "   ")
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a blank reason: err = %v, want InvalidArgument", err)
	}

	got, err := f.reject(opAdmin(opBudi), r.GetId(), "  an order's parcel waiting for its pick ")
	if err != nil {
		t.Fatalf("reject: %v", err)
	}

	if got.GetStatus() != inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_REJECTED || got.GetDecidedById() != opBudi ||
		got.GetDecidedAtUnix() == 0 || got.GetRejectReason() != "an order's parcel waiting for its pick" ||
		len(got.GetLines()) != 0 || got.GetBlock() != inventoryv1.FoundRequestApproveBlock_FOUND_REQUEST_APPROVE_BLOCK_NOT_WAITING {
		t.Fatalf("rejected %+v, want REJECTED by Budi with the reason, no lines", got)
	}

	if after := txCount(t, f.db); after != before {
		t.Fatalf("a rejection wrote %d transaction(s)", after-before)
	}

	if n := rackCount(t, f.db, otKaosHitam, f.rakA); n != 5 {
		t.Fatalf("Rak A holds %d after a rejection, want 5", n)
	}

	_, err = f.reject(opAdmin(opBudi), r.GetId(), "again")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("rejected twice: err = %v, want FailedPrecondition", err)
	}
}

// THE REPORTER WITHDRAWS THEIR OWN — the Admin who reported one, and staff — recorded as a rejection whose decider is the
// reporter. Staff rejecting somebody else's is refused.
func TestFoundRequestReject_TheReporterWithdrawsTheirOwn(t *testing.T) {
	f := opnameStocked(t)
	budis := f.mustReport(t, opAdmin(opBudi), otKaosHitam, f.rakA, 1)
	anis := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakB, 1)
	dodis := f.mustReport(t, opStaff(opDodi), otKaosHitam, f.rakB, 1)

	got, err := f.reject(opAdmin(opBudi), budis.GetId(), "counted twice — it was on Rak B")
	if err != nil {
		t.Fatalf("Budi withdrawing his own: %v", err)
	}

	if got.GetDecidedById() != got.GetReportedById() {
		t.Fatalf("withdrawn %+v, want the reporter as the decider", got)
	}

	_, err = f.reject(opStaff(opAni), dodis.GetId(), "not his")
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("staff rejecting another's: err = %v, want PermissionDenied", err)
	}

	got, err = f.reject(opStaff(opAni), anis.GetId(), "my mistake, an order's parcel")
	if err != nil {
		t.Fatalf("Ani withdrawing her own: %v", err)
	}

	if got.GetStatus() != inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_REJECTED || got.GetDecidedById() != opAni {
		t.Fatalf("withdrawn %+v, want REJECTED by Ani", got)
	}

	// The Owner rejects anybody's.
	_, err = f.reject(opOwner(opDewi), dodis.GetId(), "a sample from the supplier, not stock")
	if err != nil {
		t.Fatalf("the Owner rejecting: %v", err)
	}
}

// A SETTLED OR APPROVED REQUEST IS NOT REJECTED.
func TestFoundRequestReject_NotWaitingIsRefused(t *testing.T) {
	f := opnameStocked(t)
	r := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakA, 1)

	_, err := f.approve(opAdmin(opBudi), r.GetId())
	if err != nil {
		t.Fatalf("approve: %v", err)
	}

	_, err = f.reject(opAdmin(opBudi), r.GetId(), "too late")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("rejecting an approved request: err = %v, want FailedPrecondition", err)
	}

	_, err = f.reject(opAdmin(opBudi), 999999, "nothing")
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("an unknown request: err = %v, want NotFound", err)
	}
}
