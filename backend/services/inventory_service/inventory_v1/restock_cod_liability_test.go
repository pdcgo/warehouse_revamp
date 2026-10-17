package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE COURIER'S CHARGE AT THE DOOR (balance-posts-the-couriers-debt-from-the-event). The accept saves the charge and its
// note on the restock, inside its own transaction, and announces them on *Restock Accepted*; balance posts what the
// selling team owes the warehouse from that event. The accept itself never writes balance's tables.

const (
	codSellingTeam uint64 = 2
	codWarehouse   uint64 = 5
)

// acceptWithCOD creates a restock request and has the warehouse accept it, paying `codFee` at the
// door. Returns the request id.
func acceptWithCOD(
	t *testing.T,
	db *gorm.DB,
	svc *inventory_v1.Service,
	codFee int64,
) (uint64, error) {
	t.Helper()

	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: codSellingTeam, WarehouseId: codWarehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 10, Total: 500000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	reqID := created.Msg.GetRequest().GetId()

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId:                  codWarehouse,
		RequestId:               reqID,
		WarehouseAdditionalCost: float64(codFee), WarehouseAdditionalCostNote: courierNote,
		Lines: allArrived(t, db, created.Msg.GetRequest()),
	}))

	return reqID, err
}

// ⚠ RECORDING THE CHARGE MUST NOT REMOVE IT FROM COSTING. The same rupiah answers two different questions — what the
// goods cost (#155) and who is owed for them — and the stored charge is what both read.
func TestRestockAccept_TheCODFeeStillReachesCosting(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	reqID, err := acceptWithCOD(t, db, svc, 25000)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	if stored := storedRestock(t, db, reqID).WarehouseAdditionalCost; stored != 25000 {
		t.Fatalf("the charge is %v, want 25000 — HPP reads this column", stored)
	}
}

// The accept writes no debt of its own — even with a charge, the liability port is never asked
// (balance-posts-the-couriers-debt-from-the-event).
func TestRestockAccept_PostsNoDebtItself(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithLiability(t, db, poster)

	_, err := acceptWithCOD(t, db, svc, 25000)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	if len(poster.damaged) != 0 {
		t.Fatalf("the accept posted %+v to liability, want nothing — balance posts from the event", poster.damaged)
	}
}

// *Restock Accepted* carries the charge, its note and who counted the box in — what balance posts the debt from.
func TestRestockAccept_TheEventCarriesTheCourierCharge(t *testing.T) {
	db := san_testdb.DB(t)
	sender := &recordingSender{}
	svc := inventory_v1.NewService(db, nil, nil, nil, sender.send, nil)

	created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: codSellingTeam, WarehouseId: codWarehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 10, Total: 500000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, err = svc.RestockRequestAccept(ctxUser(9), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: codWarehouse, RequestId: created.Msg.GetRequest().GetId(),
		WarehouseAdditionalCost: 25000, WarehouseAdditionalCostNote: courierNote,
		Lines: allArrived(t, db, created.Msg.GetRequest()),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	var accepted bool

	for _, event := range sender.sent {
		a := event.GetRestockAccepted()
		if a == nil {
			continue
		}

		accepted = true

		if a.GetWarehouseAdditionalCost() != 25000 || a.GetWarehouseAdditionalCostNote() != courierNote || a.GetActorId() != 9 {
			t.Fatalf("event carries charge %v, note %q, actor %v — want 25000, %q, 9",
				a.GetWarehouseAdditionalCost(), a.GetWarehouseAdditionalCostNote(), a.GetActorId(), courierNote)
		}
	}

	if !accepted {
		t.Fatal("no Restock Accepted was published")
	}
}
