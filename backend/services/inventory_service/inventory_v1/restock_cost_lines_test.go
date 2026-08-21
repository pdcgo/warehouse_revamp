package inventory_v1_test

import (
	"errors"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A DELIVERY COSTS THE WAREHOUSE MORE THAN THE FEE AT THE DOOR (00021).
//
// The fee had its own column, so it was the only outlay the system could hold: unloading, a pickup,
// packaging the warehouse supplied were either not recorded or typed into the COD box under the wrong
// name. These tests cover what the column could not do.
//
// ⚠ THE POINT IS THAT ONE LINE DOES TWO THINGS. Every cost line raises the requesting team's debt AND
// lands in the HPP the batch freezes. A change that satisfies one of those and quietly drops the other
// is the failure worth testing for, so both are asserted from the same acceptance.

const (
	clSellingTeam uint64 = 2
	clWarehouse   uint64 = 5
	clProduct     uint64 = 620
)

func costLine(kind inventoryv1.RestockCostKind, amount int64, note string) *inventoryv1.RestockCostLine {
	return &inventoryv1.RestockCostLine{Kind: kind, Amount: amount, Note: note}
}

// acceptWithCosts raises a 10-unit request worth 500.000 with 15.000 of the buying team's own
// freight, then accepts it with `lines` as what the warehouse paid.
func acceptWithCosts(
	t *testing.T,
	svc *inventory_v1.Service,
	product uint64,
	lines []*inventoryv1.RestockCostLine,
) (uint64, error) {
	t.Helper()

	ctx := ctxUser(9)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: clSellingTeam, WarehouseId: clWarehouse, ShippingCode: "jne",
		ShippingCost: 15000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: product, Sku: "SKU-CL", Name: "Widget", Quantity: 10, TotalPrice: 500000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	reqID := created.Msg.GetRequest().GetId()

	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId:    clWarehouse,
		RequestId: reqID,
		CostLines: lines,
		Lines:     allArrived(created.Msg.GetRequest()),
	}))

	return reqID, err
}

// SEVERAL COSTS ON ONE DELIVERY — the case the single column could not represent at all.
func TestRestockFulfil_RecordsEveryCostLine(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithSettlement(t, db, poster)

	reqID, err := acceptWithCosts(t, svc, clProduct, []*inventoryv1.RestockCostLine{
		costLine(inventoryv1.RestockCostKind_RESTOCK_COST_KIND_COD_SHIPPING, 25000, ""),
		costLine(inventoryv1.RestockCostKind_RESTOCK_COST_KIND_OTHER, 5000, "porter at the gate"),
	})
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	var stored []inventory_service_models.RestockCostLine

	err = db.Where("restock_request_id = ?", reqID).Order("id ASC").Find(&stored).Error
	if err != nil {
		t.Fatalf("read cost lines: %v", err)
	}

	if len(stored) != 2 {
		t.Fatalf("%d cost lines stored, want 2 — a delivery can cost more than one thing", len(stored))
	}

	if stored[0].Kind != "cod_shipping" || stored[0].Amount != 25000 {
		t.Fatalf("first line = %+v, want cod_shipping 25000", stored[0])
	}

	// The NOTE is the whole reason `other` is allowed: it is what the team being charged reads.
	if stored[1].Kind != "other" || stored[1].Amount != 5000 || stored[1].Note != "porter at the gate" {
		t.Fatalf("second line = %+v, want other 5000 'porter at the gate'", stored[1])
	}

	// WHO TYPED IT. A cost charged to another team with nobody's name on it is the first thing a
	// dispute asks for.
	for i := range stored {
		if stored[i].ActorID != 9 {
			t.Fatalf("line %d names actor %d, want the accepting user 9", i, stored[i].ActorID)
		}
	}
}

// ONE DEBT PER DELIVERY, for the SUM. Posting per line would make the ledger's source_id name a cost
// row while every other source names a business object — and would put two debts on one delivery.
func TestRestockFulfil_PostsOneObligationForTheWholeOutlay(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithSettlement(t, db, poster)

	reqID, err := acceptWithCosts(t, svc, clProduct, []*inventoryv1.RestockCostLine{
		costLine(inventoryv1.RestockCostKind_RESTOCK_COST_KIND_COD_SHIPPING, 25000, ""),
		costLine(inventoryv1.RestockCostKind_RESTOCK_COST_KIND_OTHER, 5000, "porter"),
	})
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	if len(poster.posted) != 1 {
		t.Fatalf("%d obligations posted, want exactly 1 for the delivery", len(poster.posted))
	}

	got := poster.posted[0]

	if got.amount != 30000 {
		t.Fatalf("posted %d, want the 30000 the warehouse actually laid out", got.amount)
	}

	if got.restockRequestID != reqID {
		t.Fatalf("source id = %d, want the request %d", got.restockRequestID, reqID)
	}

	if got.sellingTeamID != clSellingTeam || got.warehouseID != clWarehouse {
		t.Fatalf("posted %d owes %d, want %d owes %d — the direction is the whole point",
			got.sellingTeamID, got.warehouseID, clSellingTeam, clWarehouse)
	}
}

// ⚠ THE SAME RUPIAH ANSWERS TWO QUESTIONS. The debt above must not have taken the money OUT of
// costing: every line is freight, spread over the units that arrived sellable.
//
//	(15.000 own freight + 25.000 + 5.000) / 10 units = 4.500 per unit
//	500.000 / 10 = 50.000 goods per unit  →  54.500 HPP
func TestRestockFulfil_EveryCostLineReachesTheHPP(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithSettlement(t, db, &recordingPoster{})

	_, err := acceptWithCosts(t, svc, clProduct, []*inventoryv1.RestockCostLine{
		costLine(inventoryv1.RestockCostKind_RESTOCK_COST_KIND_COD_SHIPPING, 25000, ""),
		costLine(inventoryv1.RestockCostKind_RESTOCK_COST_KIND_OTHER, 5000, "porter"),
	})
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	cost, err := svc.StockCost(ctxUser(9), connect.NewRequest(&inventoryv1.StockCostRequest{
		TeamId: clSellingTeam,
		Filter: &inventoryv1.StockCostFilter{WarehouseId: clWarehouse, Ids: []uint64{clProduct}},
	}))
	if err != nil {
		t.Fatalf("stock cost: %v", err)
	}

	lines := stockCostLines(cost.Msg)
	if len(lines) != 1 {
		t.Fatalf("%d cost lines returned, want 1", len(lines))
	}

	if lines[0].GetUnitCost() != 54500 {
		t.Fatalf("HPP = %d, want 54500 — a cost line that raises a debt must also raise the cost",
			lines[0].GetUnitCost())
	}
}

// AN 'OTHER' WITH NO NOTE IS REFUSED. It is the escape hatch, and the note is what stops it being a
// black hole: an untyped amount with no words beside it is a number the team being charged cannot
// argue with. The pair rule cannot be expressed in protovalidate, so it is the handler's.
func TestRestockFulfil_RefusesAnOtherCostWithNoNote(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithSettlement(t, db, &recordingPoster{})

	_, err := acceptWithCosts(t, svc, clProduct, []*inventoryv1.RestockCostLine{
		costLine(inventoryv1.RestockCostKind_RESTOCK_COST_KIND_OTHER, 5000, ""),
	})
	if err == nil {
		t.Fatal("an unexplained cost was accepted and charged to another team")
	}

	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("refused with %v, want InvalidArgument", connect.CodeOf(err))
	}
}

// AN UNKNOWN KIND IS REFUSED rather than stored as text nothing can read back. It would still be
// charged, while showing on the screen that has to justify it as "unspecified".
func TestRestockFulfil_RefusesAnUnknownCostKind(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithSettlement(t, db, &recordingPoster{})

	_, err := acceptWithCosts(t, svc, clProduct, []*inventoryv1.RestockCostLine{
		{Kind: inventoryv1.RestockCostKind_RESTOCK_COST_KIND_UNSPECIFIED, Amount: 5000},
	})
	if err == nil {
		t.Fatal("a cost of no known kind was accepted")
	}

	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("refused with %v, want InvalidArgument", connect.CodeOf(err))
	}
}

// A REFUSED LINE LEAVES NOTHING BEHIND — the validation runs before the transaction, so a delivery is
// never half-received because of a typo in a cost.
func TestRestockFulfil_ARefusedCostLineReceivesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithSettlement(t, db, &recordingPoster{})

	reqID, err := acceptWithCosts(t, svc, clProduct, []*inventoryv1.RestockCostLine{
		costLine(inventoryv1.RestockCostKind_RESTOCK_COST_KIND_OTHER, 5000, ""),
	})
	if err == nil {
		t.Fatal("the acceptance succeeded with an unexplained cost on it")
	}

	var stored inventory_service_models.RestockRequest

	readErr := db.Where("id = ?", reqID).Take(&stored).Error
	if readErr != nil {
		t.Fatalf("read request: %v", readErr)
	}

	if stored.Status == "fulfilled" {
		t.Fatal("the request was fulfilled despite the cost being refused")
	}

	var levels int64

	readErr = db.
		Model(&inventory_service_models.StockLevel{}).
		Where("warehouse_id = ?", clWarehouse).
		Count(&levels).
		Error
	if readErr != nil {
		t.Fatalf("count stock: %v", readErr)
	}

	if levels != 0 {
		t.Fatalf("%d stock levels landed on a refused acceptance", levels)
	}
}

// NO COSTS AT ALL is the ordinary delivery, and it must post nothing: an entry of zero reads as a debt
// of nothing rather than the absence of one.
func TestRestockFulfil_NoCostsMeanNoObligationAndNoRows(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithSettlement(t, db, poster)

	reqID, err := acceptWithCosts(t, svc, clProduct, nil)
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	if len(poster.posted) != 0 {
		t.Fatalf("%d obligations posted for a delivery that cost the warehouse nothing", len(poster.posted))
	}

	var count int64

	err = db.
		Model(&inventory_service_models.RestockCostLine{}).
		Where("restock_request_id = ?", reqID).
		Count(&count).
		Error
	if err != nil {
		t.Fatalf("count cost lines: %v", err)
	}

	if count != 0 {
		t.Fatalf("%d cost lines written for a delivery that cost nothing", count)
	}
}

// The lines and the debt are ONE TRANSACTION with the goods. If the posting fails, neither the stock
// nor the costs may survive — otherwise the warehouse's own record says it paid for a delivery the
// system never received.
func TestRestockFulfil_AFailedPostingRollsBackTheCostLines(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{fail: errors.New("the ledger is down")}
	svc := newServiceWithSettlement(t, db, poster)

	reqID, err := acceptWithCosts(t, svc, clProduct, []*inventoryv1.RestockCostLine{
		costLine(inventoryv1.RestockCostKind_RESTOCK_COST_KIND_COD_SHIPPING, 25000, ""),
	})
	if err == nil {
		t.Fatal("the acceptance succeeded while its obligation failed")
	}

	var count int64

	readErr := db.
		Model(&inventory_service_models.RestockCostLine{}).
		Where("restock_request_id = ?", reqID).
		Count(&count).
		Error
	if readErr != nil {
		t.Fatalf("count cost lines: %v", readErr)
	}

	if count != 0 {
		t.Fatalf("%d cost lines survived a rolled-back acceptance", count)
	}
}
