package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE WAREHOUSE SIGNS FOR THE BOX (the-warehouse-signs-and-accepts-the-team-does-the-rest): ongoing or lost → arrived.
// It moves no stock; it opens the arrived window, in which the selling team still changes the lines
// (the-lines-stay-editable-until-accepted).

const (
	arrSellingTeam uint64 = 2
	arrWarehouse   uint64 = 5
	arrOtherHouse  uint64 = 6
	arrBuyer       uint64 = 11
	arrSigner      uint64 = 12
	arrCounter     uint64 = 13
	arrAccount     uint64 = 7
	arrMelati      uint64 = 31
	arrSinar       uint64 = 32
)

var (
	statusArrived = inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ARRIVED
	statusLost    = inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_LOST
)

// arrLines are a restock's two lines as the selling team raises them: Kaos from Melati, Celana from no one named.
func arrLines() []*inventoryv1.RestockRequestItem {
	return []*inventoryv1.RestockRequestItem{
		{ProductId: 100, Sku: "SKU-KAOS", Name: "Kaos", Count: 10, Total: 100000, SupplierId: arrMelati},
		{ProductId: 200, Sku: "SKU-CELANA", Name: "Celana", Count: 5, Total: 150000},
	}
}

// arrRaise raises a restock as the buyer, the way the form does: a paying account and two lines.
func arrRaise(t *testing.T, svc *inventory_v1.Service) *inventoryv1.RestockRequest {
	t.Helper()

	created, err := svc.RestockRequestCreate(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: arrSellingTeam, WarehouseId: arrWarehouse, FinanceAccountId: arrAccount,
		Receipt: "SCP123", ShipmentCost: 20000,
		Items: arrLines(),
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	return created.Msg.GetRequest()
}

func arrSign(svc *inventory_v1.Service, teamID, requestID uint64) (*inventoryv1.RestockRequest, error) {
	resp, err := svc.RestockRequestArrive(ctxUser(arrSigner), connect.NewRequest(&inventoryv1.RestockRequestArriveRequest{
		TeamId: teamID, RequestId: requestID,
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg.GetRequest(), nil
}

func arrDetail(t *testing.T, svc *inventory_v1.Service, requestID uint64) *inventoryv1.RestockRequest {
	t.Helper()

	detail, err := svc.RestockRequestDetail(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: arrSellingTeam, RequestId: requestID,
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	return detail.Msg.GetRequest()
}

// Signed for: arrived, by whom and when, and the trail says ongoing → arrived — read by the SELLING team, who is the
// one waiting to know the box is in.
func TestRestockRequestArrive_SignsAnOngoingBox(t *testing.T) {
	db := san_testdb.DB(t)
	svc := arrService(t, db)

	raised := arrRaise(t, svc)

	signed, err := arrSign(svc, arrWarehouse, raised.GetId())
	if err != nil {
		t.Fatalf("arrive: %v", err)
	}

	if signed.GetStatus() != statusArrived || signed.GetArrivedByUserId() != arrSigner || signed.GetArrivedAtUnix() <= 0 {
		t.Fatalf("signed = status %v by %d at %d, want arrived by %d with a moment",
			signed.GetStatus(), signed.GetArrivedByUserId(), signed.GetArrivedAtUnix(), arrSigner)
	}

	if len(signed.GetItems()) != 2 {
		t.Fatalf("the signed restock carries %d lines, want 2", len(signed.GetItems()))
	}

	got := trail(arrDetail(t, svc, raised.GetId()))
	want := []trailStep{stepCreated, {ongoing, statusArrived, "signed for the box"}}

	if len(got) != len(want) || got[1] != want[1] {
		t.Fatalf("trail = %v, want %v", got, want)
	}
}

// A LATE LOST BOX IS SIGNED FOR (a-late-lost-box-is-signed-for-as-arrived): given up, then it turns up. The trail keeps
// both — it WAS given up — and so does the record of who gave it up.
func TestRestockRequestArrive_SignsALateLostBox(t *testing.T) {
	db := san_testdb.DB(t)
	svc := arrService(t, db)

	raised := arrRaise(t, svc)

	_, err := svc.RestockRequestMarkLost(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestMarkLostRequest{
		TeamId: arrSellingTeam, RequestId: raised.GetId(),
	}))
	if err != nil {
		t.Fatalf("mark lost: %v", err)
	}

	signed, err := arrSign(svc, arrWarehouse, raised.GetId())
	if err != nil {
		t.Fatalf("arrive a lost box: %v", err)
	}

	if signed.GetStatus() != statusArrived || signed.GetLostByUserId() != arrBuyer || signed.GetLostAtUnix() <= 0 {
		t.Fatalf("signed = status %v, lost by %d at %d — want arrived, still saying who gave it up",
			signed.GetStatus(), signed.GetLostByUserId(), signed.GetLostAtUnix())
	}

	got := trail(arrDetail(t, svc, raised.GetId()))
	if len(got) != 3 || got[1].to != statusLost || got[2] != (trailStep{statusLost, statusArrived, "signed for the box"}) {
		t.Fatalf("trail = %v, want created, ongoing → lost, lost → arrived", got)
	}
}

// Nothing left to sign: a box already signed for, counted, or called off.
func TestRestockRequestArrive_RefusesWhatHasNothingToSign(t *testing.T) {
	db := san_testdb.DB(t)
	svc := arrService(t, db)

	twice := arrRaise(t, svc)

	_, err := arrSign(svc, arrWarehouse, twice.GetId())
	if err != nil {
		t.Fatalf("first arrive: %v", err)
	}

	_, err = arrSign(svc, arrWarehouse, twice.GetId())
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("signing twice = %v, want FailedPrecondition", err)
	}

	called := arrRaise(t, svc)

	_, err = svc.RestockRequestCancel(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
		TeamId: arrSellingTeam, RequestId: called.GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	_, err = arrSign(svc, arrWarehouse, called.GetId())
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("signing a cancelled restock = %v, want FailedPrecondition", err)
	}

	counted := arrRaise(t, svc)

	_, err = svc.RestockRequestAccept(ctxUser(arrCounter), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: arrWarehouse, RequestId: counted.GetId(), Lines: allArrived(t, db, counted),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	_, err = arrSign(svc, arrWarehouse, counted.GetId())
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("signing an accepted restock = %v, want FailedPrecondition", err)
	}
}

// ONLY THE RECEIVING WAREHOUSE SIGNS. The selling team cannot declare its own box arrived, and another warehouse
// cannot even tell the restock exists.
func TestRestockRequestArrive_OnlyTheReceivingWarehouseSigns(t *testing.T) {
	db := san_testdb.DB(t)
	svc := arrService(t, db)

	raised := arrRaise(t, svc)

	for _, team := range []uint64{arrSellingTeam, arrOtherHouse} {
		_, err := arrSign(svc, team, raised.GetId())
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("signing as team %d = %v, want NotFound", team, err)
		}
	}

	if got := arrDetail(t, svc, raised.GetId()).GetStatus(); got != ongoing {
		t.Fatalf("after two refused signs the restock is %v, want still ongoing", got)
	}
}

// THE ARRIVED WINDOW (the-lines-stay-editable-until-accepted, lines-can-be-added-not-removed-while-arrived,
// a-line-added-after-arrival-names-its-supplier): once signed, the selling team changes the lines and nothing else;
// it may add a line, naming its supplier, but not drop one, and a stored line keeps its supplier.
func TestRestockRequestArrive_OpensTheArrivedWindow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := arrService(t, db)

	raised := arrRaise(t, svc)

	_, err := arrSign(svc, arrWarehouse, raised.GetId())
	if err != nil {
		t.Fatalf("arrive: %v", err)
	}

	edit := func(mutate func(*inventoryv1.RestockRequestUpdateRequest)) error {
		req := &inventoryv1.RestockRequestUpdateRequest{
			TeamId: arrSellingTeam, RequestId: raised.GetId(),
			WarehouseId: arrWarehouse, FinanceAccountId: arrAccount, Receipt: "SCP123", ShipmentCost: 20000,
			Items: arrLines(),
		}
		mutate(req)

		_, updErr := svc.RestockRequestUpdate(ctxUser(arrBuyer), connect.NewRequest(req))

		return updErr
	}

	// Not the lines: refused.
	err = edit(func(r *inventoryv1.RestockRequestUpdateRequest) { r.Receipt = "SCP999" })
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("changing the tracking number once arrived = %v, want FailedPrecondition", err)
	}

	// A line dropped: refused.
	err = edit(func(r *inventoryv1.RestockRequestUpdateRequest) { r.Items = r.Items[:1] })
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("dropping a line once arrived = %v, want FailedPrecondition", err)
	}

	// A stored line's supplier changed: refused.
	err = edit(func(r *inventoryv1.RestockRequestUpdateRequest) { r.Items[0].SupplierId = arrSinar })
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("re-attributing a stored line once arrived = %v, want FailedPrecondition", err)
	}

	// 12 in a box of 10, and an unordered product turned up: the count and note change, and a new line names its store.
	err = edit(func(r *inventoryv1.RestockRequestUpdateRequest) {
		r.Items[0].Count = 12
		r.Items[0].Total = 120000
		r.Items[0].Note = "extra stock"
		r.Items = append(r.Items, &inventoryv1.RestockRequestItem{
			ProductId: 300, Sku: "SKU-TOPI", Name: "Topi", Count: 2, Total: 30000, SupplierId: arrSinar,
			Note: "came in the box",
		})
	})
	if err != nil {
		t.Fatalf("editing the lines once arrived: %v", err)
	}

	got := arrDetail(t, svc, raised.GetId())

	if got.GetStatus() != statusArrived || len(got.GetItems()) != 3 {
		t.Fatalf("after the edit: status %v with %d lines, want arrived with 3", got.GetStatus(), len(got.GetItems()))
	}

	kaos, topi := got.GetItems()[0], got.GetItems()[2]
	if kaos.GetCount() != 12 || kaos.GetNote() != "extra stock" || kaos.GetSupplierId() != arrMelati {
		t.Fatalf("Kaos reads %d %q from %d, want 12 \"extra stock\" still from Melati",
			kaos.GetCount(), kaos.GetNote(), kaos.GetSupplierId())
	}

	if topi.GetProductId() != 300 || topi.GetSupplierId() != arrSinar {
		t.Fatalf("the added line reads product %d from %d, want 300 from Sinar", topi.GetProductId(), topi.GetSupplierId())
	}

	last := trail(got)[len(trail(got))-1]
	if last != (trailStep{statusArrived, statusArrived, "edited"}) {
		t.Fatalf("the edit reads on the trail as %v, want arrived → arrived, edited", last)
	}
}

// THE PERSON WHO SIGNED stays the one who signed when another person counts the box in later — and the trail reads
// arrived → accepted, not ongoing → accepted.
func TestRestockRequestArrive_AcceptKeepsWhoSigned(t *testing.T) {
	db := san_testdb.DB(t)
	svc := arrService(t, db)

	raised := arrRaise(t, svc)

	_, err := arrSign(svc, arrWarehouse, raised.GetId())
	if err != nil {
		t.Fatalf("arrive: %v", err)
	}

	_, err = svc.RestockRequestAccept(ctxUser(arrCounter), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: arrWarehouse, RequestId: raised.GetId(), Lines: allArrived(t, db, raised),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	got := arrDetail(t, svc, raised.GetId())

	if got.GetArrivedByUserId() != arrSigner || got.GetAcceptedByUserId() != arrCounter {
		t.Fatalf("signed by %d and counted by %d, want %d and %d",
			got.GetArrivedByUserId(), got.GetAcceptedByUserId(), arrSigner, arrCounter)
	}

	steps := trail(got)
	if last := steps[len(steps)-1]; last.from != statusArrived || last.to != accepted {
		t.Fatalf("the acceptance reads %v, want arrived → accepted", last)
	}
}

// arrService is the service with Melati and Sinar live in supplier_service, the two stores these restocks name.
func arrService(t *testing.T, db *gorm.DB) *inventory_v1.Service {
	t.Helper()

	return newServiceWithSuppliers(t, db, fakeSuppliers{arrMelati: true, arrSinar: true})
}
