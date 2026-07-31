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

// WHAT THE COURIER TOOK AT THE DOOR IS WRITTEN DOWN, AND IT CHANGES WHAT THE DELIVERY COST (owner).
//
// Two claims, and the second is the one that decays quietly: a fee can land in its column and still
// never reach the number a person reads. The COD fee is entered by the WAREHOUSE at acceptance (#155)
// but it is the REQUESTING TEAM that pays for the goods, so the total on the requesting team's screen
// is the only place that fee becomes real to the side settling it (#184). A stored column nobody adds
// up is a fee that was recorded and forgotten.
//
// ⚠ THE TOTAL IS ASSERTED AS A DELTA, not as a constant. Goods 500.000 + freight 15.000 + COD 25.000 is
// an arithmetic anybody can restate; "the same request accepted with and without the fee differs by
// exactly the fee" is the property that survives someone changing the fixture's prices, and it is the
// one that breaks if the fee is ever double-counted or dropped from the sum.

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
		TeamId: feeSellingTeam, WarehouseId: feeWarehouse, ShippingCode: "jne",
		ShippingCost: 15000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: product, Sku: "SKU-COD", Name: "Widget", Quantity: 10, TotalPrice: 500000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	reqID := created.Msg.GetRequest().GetId()

	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: feeWarehouse, RequestId: reqID,
		CodShippingFee: codFee,
		Lines:          allArrived(created.Msg.GetRequest()),
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	// Read back through DETAIL rather than off the fulfil response: the response is built from the
	// struct the handler just mutated in memory, so it would agree with itself even if nothing was
	// written. Detail goes to the row.
	detail, err := svc.RestockRequestDetail(ctx, connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: feeSellingTeam, RequestId: reqID,
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	// The COLUMN itself, in the database, not just what the RPC chose to echo. HPP reads this column
	// directly (stock_cost.go), so a fee that reached the wire but not the row would still cost wrong.
	var stored inventory_service_models.RestockRequest

	err = db.Where("id = ?", reqID).Take(&stored).Error
	if err != nil {
		t.Fatalf("read request row: %v", err)
	}

	if stored.CODShippingFee != codFee {
		t.Fatalf("cod_shipping_fee = %d in the database, want %d", stored.CODShippingFee, codFee)
	}

	return detail.Msg.GetRequest()
}

// committed is what the whole restock cost — goods plus every freight charge on them. The same sum
// the selling detail screen puts under its lines (summary.ts committedValue).
func committed(r *inventoryv1.RestockRequest) int64 {
	var goods int64
	for _, item := range r.GetItems() {
		goods += item.GetTotalPrice()
	}

	return goods + r.GetShippingCost() + r.GetCodShippingFee()
}

func TestRestockFulfil_TheCODFeeIsRecordedAndMovesTheTotal(t *testing.T) {
	db := san_testdb.DB(t)

	req := acceptWithFee(t, db, newService(t, db), feeProduct, 25000)

	if req.GetCodShippingFee() != 25000 {
		t.Fatalf("cod fee reads back as %d, want 25000 — the requesting team cannot settle a fee it "+
			"is never shown", req.GetCodShippingFee())
	}

	// 500.000 goods + 15.000 freight + 25.000 at the door.
	if got := committed(req); got != 540000 {
		t.Fatalf("committed total = %d, want 540000 — the fee is on the record but not in the sum", got)
	}
}

// THE CONTROL. Without it the assertion above passes on a total that simply happens to be 540.000 for
// some other reason, and "the fee moved the total" is not what was tested.
func TestRestockFulfil_NoCODFeeLeavesTheTotalAtTheOrderedValue(t *testing.T) {
	db := san_testdb.DB(t)

	req := acceptWithFee(t, db, newService(t, db), feeProduct, 0)

	if req.GetCodShippingFee() != 0 {
		t.Fatalf("cod fee = %d on a delivery nobody paid for at the door, want 0",
			req.GetCodShippingFee())
	}

	if got := committed(req); got != 515000 {
		t.Fatalf("committed total = %d, want 515000 (goods + freight, no door fee)", got)
	}
}

// THE DELTA IS EXACTLY THE FEE — the property the two tests above only imply. Counting the fee twice
// (once into a stored total and once into the sum) or spreading it into the line prices would leave
// both of those passing and this one failing.
func TestRestockFulfil_TheTotalRisesByExactlyTheCODFee(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	// Two products, one transaction — see acceptWithFee's note. Same prices, same freight, so the only
	// difference between the two totals is the fee.
	withFee := committed(acceptWithFee(t, db, svc, feeProduct, 25000))
	without := committed(acceptWithFee(t, db, svc, feeProductB, 0))

	if withFee-without != 25000 {
		t.Fatalf("the fee moved the total by %d, want exactly the 25000 paid at the door",
			withFee-without)
	}
}
