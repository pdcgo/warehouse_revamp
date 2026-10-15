package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE SELLING TEAM GIVES THE PARCEL UP (lost-is-set-only-before-the-box-arrives): ongoing → lost, and only from
// ongoing. A box in the building is not lost; a unit missing from it is a problem row at the count.

func markLost(svc *inventory_v1.Service, teamID, requestID uint64, why string) (*inventoryv1.RestockRequest, error) {
	resp, err := svc.RestockRequestMarkLost(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestMarkLostRequest{
		TeamId: teamID, RequestId: requestID, Description: why,
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg.GetRequest(), nil
}

// Given up: lost, by whom and when, and the selling team's why on the trail row.
func TestRestockRequestMarkLost_GivesUpAnOngoingParcel(t *testing.T) {
	db := san_testdb.DB(t)
	svc := arrService(t, db)

	raised := arrRaise(t, svc)

	lost, err := markLost(svc, arrSellingTeam, raised.GetId(), "courier says the parcel is gone")
	if err != nil {
		t.Fatalf("mark lost: %v", err)
	}

	if lost.GetStatus() != statusLost || lost.GetLostByUserId() != arrBuyer || lost.GetLostAtUnix() <= 0 {
		t.Fatalf("lost = status %v by %d at %d, want lost by %d with a moment",
			lost.GetStatus(), lost.GetLostByUserId(), lost.GetLostAtUnix(), arrBuyer)
	}

	steps := trail(arrDetail(t, svc, raised.GetId()))
	want := trailStep{ongoing, statusLost, "given up as lost — courier says the parcel is gone"}

	if last := steps[len(steps)-1]; last != want {
		t.Fatalf("the trail ends %v, want %v", last, want)
	}
}

// Without a why, the trail row still says what happened.
func TestRestockRequestMarkLost_AWhyIsOptional(t *testing.T) {
	db := san_testdb.DB(t)
	svc := arrService(t, db)

	raised := arrRaise(t, svc)

	_, err := markLost(svc, arrSellingTeam, raised.GetId(), "")
	if err != nil {
		t.Fatalf("mark lost: %v", err)
	}

	steps := trail(arrDetail(t, svc, raised.GetId()))
	if last := steps[len(steps)-1]; last != (trailStep{ongoing, statusLost, "given up as lost"}) {
		t.Fatalf("the trail ends %v, want ongoing → lost, given up as lost", last)
	}
}

// ONLY WHILE ONGOING: a signed-for box, a cancelled restock and an already-lost one are refused.
func TestRestockRequestMarkLost_OnlyWhileOngoing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := arrService(t, db)

	signed := arrRaise(t, svc)

	_, err := arrSign(svc, arrWarehouse, signed.GetId())
	if err != nil {
		t.Fatalf("arrive: %v", err)
	}

	_, err = markLost(svc, arrSellingTeam, signed.GetId(), "")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("giving up a box already signed for = %v, want FailedPrecondition", err)
	}

	called := arrRaise(t, svc)

	_, err = svc.RestockRequestCancel(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
		TeamId: arrSellingTeam, RequestId: called.GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	_, err = markLost(svc, arrSellingTeam, called.GetId(), "")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("giving up a cancelled restock = %v, want FailedPrecondition", err)
	}

	twice := arrRaise(t, svc)

	_, err = markLost(svc, arrSellingTeam, twice.GetId(), "")
	if err != nil {
		t.Fatalf("first mark lost: %v", err)
	}

	_, err = markLost(svc, arrSellingTeam, twice.GetId(), "")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("giving up twice = %v, want FailedPrecondition", err)
	}
}

// THE SELLING TEAM'S CALL. The warehouse cannot give up a parcel it is waiting for; to it the restock reads as
// NotFound, exactly as cancel does.
func TestRestockRequestMarkLost_OnlyTheSellingTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := arrService(t, db)

	raised := arrRaise(t, svc)

	_, err := markLost(svc, arrWarehouse, raised.GetId(), "")
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("the warehouse giving it up = %v, want NotFound", err)
	}
}

// A LOST RESTOCK IS NEITHER COUNTED NOR CALLED OFF. The money left with the parcel; only signing for a late box brings
// it back to the door (a-late-lost-box-is-signed-for-as-arrived).
func TestRestockRequestMarkLost_ALostRestockIsNeitherAcceptedNorCancelled(t *testing.T) {
	db := san_testdb.DB(t)
	svc := arrService(t, db)

	raised := arrRaise(t, svc)

	_, err := markLost(svc, arrSellingTeam, raised.GetId(), "")
	if err != nil {
		t.Fatalf("mark lost: %v", err)
	}

	_, err = svc.RestockRequestAccept(ctxUser(arrCounter), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: arrWarehouse, RequestId: raised.GetId(), Lines: allArrived(t, db, raised),
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("accepting a lost restock = %v, want FailedPrecondition", err)
	}

	_, err = svc.RestockRequestCancel(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
		TeamId: arrSellingTeam, RequestId: raised.GetId(),
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("cancelling a lost restock = %v, want FailedPrecondition", err)
	}
}
