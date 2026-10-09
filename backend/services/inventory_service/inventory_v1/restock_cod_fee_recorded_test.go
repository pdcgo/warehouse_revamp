package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// WHAT THE COURIER TOOK AT THE DOOR IS WRITTEN DOWN — AND KEPT OUT OF THE RESTOCK'S TOTAL.
//
// The courier's charge is entered by the WAREHOUSE at acceptance (#155), paid from the warehouse's cash, and owed back
// by the selling team as its own debt (the-warehouse-cost-is-the-couriers-charge-at-the-door). It reads back as the
// restock's one `warehouse_additional_cost` (the-courier-is-paid-once-per-restock).
//
// ⚠ the-couriers-charge-stays-out-of-total REVERSED what these tests used to assert. They pinned the charge INSIDE
// the total ("the fee moved the total"); the decision is that `total` is what the selling team's paying account paid —
// goods plus agreed shipping — and adding a charge the warehouse paid later would make it disagree with that account.
//
// ⚠ STILL ASSERTED AS A DELTA, not as a constant: "the same request accepted with and without the charge has the SAME
// total, and the charge differs by exactly the charge" survives someone changing the fixture's prices, and breaks if
// the charge is ever folded into the total or dropped from its own field.

const (
	feeSellingTeam uint64 = 2
	feeWarehouse   uint64 = 5
	feeProduct     uint64 = 410
	feeProductB    uint64 = 411
)

// acceptWithFee raises a restock with a known goods total and freight, has the warehouse accept it
// paying `codFee` at the door, and returns the request as the SELLING TEAM reads it back — which is
// the side that owes the money and the side whose screen shows the total.
//
// ⚠ `product` is a parameter, and the delta test below is why. Two acceptances of the SAME product
// take the same `stock_levels` row, and each of these tests runs inside a transaction that is never
// committed — so two of them in one test would deadlock on that row rather than fail. Different
// products, no shared row, and the two acceptances can live in one transaction the way the rest of the
// suite expects.
func acceptWithFee(
	t *testing.T,
	db *gorm.DB,
	svc *inventory_v1.Service,
	product uint64,
	codFee int64,
) *inventoryv1.RestockRequest {
	t.Helper()

	ctx := ctxUser(7)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: feeSellingTeam, WarehouseId: feeWarehouse,
		ShipmentCost: 15000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: product, Sku: "SKU-COD", Name: "Widget", Count: 10, Total: 500000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	reqID := created.Msg.GetRequest().GetId()

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: feeWarehouse, RequestId: reqID,
		WarehouseAdditionalCost: codFee, WarehouseAdditionalCostNote: courierNote,
		Lines: allArrived(t, db, created.Msg.GetRequest()),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	// Read back through DETAIL rather than off the accept response: the response is built from the
	// struct the handler just mutated in memory, so it would agree with itself even if nothing was
	// written. Detail goes to the row.
	detail, err := svc.RestockRequestDetail(ctx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: feeSellingTeam, RequestId: reqID,
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	// The ROWS themselves, in the database, not just what the RPC chose to echo. HPP sums these lines
	// directly (stock_cost.go), so a cost that reached the wire but not the table would still cost
	// wrong.
	var stored []inventory_service_models.RestockCostLine

	err = db.Where("restock_request_id = ?", reqID).Order("id ASC").Find(&stored).Error
	if err != nil {
		t.Fatalf("read cost lines: %v", err)
	}

	var storedTotal int64
	for i := range stored {
		storedTotal += stored[i].Amount
	}

	if storedTotal != codFee {
		t.Fatalf("cost lines total %d in the database, want %d", storedTotal, codFee)
	}

	return detail.Msg.GetRequest()
}

// codFeeOf is what the delivery cost the warehouse at the door — the restock's one courier's charge.
func codFeeOf(r *inventoryv1.RestockRequest) int64 {
	return r.GetWarehouseAdditionalCost()
}

// owed is everything the selling team is out of pocket for this restock: what its account paid (the total) plus the
// courier's charge it owes the warehouse — the charge counted ONCE, on its own field.
func owed(r *inventoryv1.RestockRequest) int64 {
	return r.GetTotal() + codFeeOf(r)
}

// the-couriers-charge-stays-out-of-total: the charge is recorded with its note, and the total is still goods plus
// shipping.
func TestRestockAccept_TheCODFeeIsRecordedAndStaysOutOfTheTotal(t *testing.T) {
	db := san_testdb.DB(t)

	req := acceptWithFee(t, db, newService(t, db), feeProduct, 25000)

	if codFeeOf(req) != 25000 {
		t.Fatalf("courier's charge reads back as %d, want 25000 — the requesting team cannot settle a fee it "+
			"is never shown", codFeeOf(req))
	}
	if req.GetWarehouseAdditionalCostNote() != courierNote {
		t.Fatalf("the charge's note = %q, want %q", req.GetWarehouseAdditionalCostNote(), courierNote)
	}

	// 500.000 goods + 15.000 freight — and NOT the 25.000 at the door.
	if req.GetSubtotal() != 500000 || req.GetTotal() != 515000 {
		t.Fatalf("subtotal/total = %d/%d, want 500000/515000 — the courier's charge stays out of the total",
			req.GetSubtotal(), req.GetTotal())
	}
}

// THE CONTROL. Without it the assertion above passes on a total that simply happens to be 515.000 for
// some other reason.
func TestRestockAccept_NoCODFeeLeavesTheTotalAtTheOrderedValue(t *testing.T) {
	db := san_testdb.DB(t)

	req := acceptWithFee(t, db, newService(t, db), feeProduct, 0)

	if codFeeOf(req) != 0 {
		t.Fatalf("courier's charge = %d on a delivery nobody paid for at the door, want 0",
			codFeeOf(req))
	}

	if got := req.GetTotal(); got != 515000 {
		t.Fatalf("total = %d, want 515000 (goods + freight, no door fee)", got)
	}
}

// THE TOTAL DOES NOT MOVE, AND WHAT IS OWED MOVES BY EXACTLY THE FEE — the property the two tests above only imply.
// Folding the charge into the total, counting it twice, or spreading it into the line prices would leave both of those
// passing and this one failing (the-couriers-charge-stays-out-of-total).
func TestRestockAccept_TheTotalStaysPutAndTheChargeIsCountedOnce(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	// Two products, one transaction — see acceptWithFee's note. Same prices, same freight, so the only
	// difference between the two restocks is the charge.
	withFee := acceptWithFee(t, db, svc, feeProduct, 25000)
	without := acceptWithFee(t, db, svc, feeProductB, 0)

	if withFee.GetTotal() != without.GetTotal() {
		t.Fatalf("the charge moved the total from %d to %d — it must stay out of it",
			without.GetTotal(), withFee.GetTotal())
	}

	if owed(withFee)-owed(without) != 25000 {
		t.Fatalf("the charge moved what is owed by %d, want exactly the 25000 paid at the door",
			owed(withFee)-owed(without))
	}
}
