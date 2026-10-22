package inventory_v1_test

import (
	"strings"
	"testing"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// WHAT THE DELIVERY COST THE WAREHOUSE AT THE DOOR (00021).
//
// These tests were written for COST LINES — several outlays per delivery, each with a kind. The-courier-is-paid-once-
// per-restock replaced them: a restock carries ONE courier's charge, `warehouse_additional_cost`, with its note, and if
// the courier asks for two things the warehouse enters their sum. Every case below that used several lines now uses
// that one sum, and the cases about a line's KIND became the nearest refusals the one charge still has.
//
// ⚠ THE POINT IS STILL THAT ONE CHARGE DOES TWO THINGS. It raises the requesting team's debt AND lands in the HPP the
// batch freezes (the-couriers-ask-is-in-the-unit-price). A change that satisfies one of those and quietly drops the
// other is the failure worth testing for, so both are asserted from the same acceptance.

const (
	clSellingTeam uint64 = 2
	clWarehouse   uint64 = 5
	clProduct     uint64 = 620
)

// acceptWithCosts raises a 10-unit request worth 500.000 with 15.000 of the buying team's own
// freight, then accepts it with `amount` as the courier's charge the warehouse paid, and `note` as what it was for.
func acceptWithCosts(
	t *testing.T,
	db *gorm.DB,
	svc *inventory_v1.Service,
	product uint64,
	amount int64,
	note string,
) (uint64, error) {
	t.Helper()

	ctx := ctxUser(9)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: clSellingTeam, WarehouseId: clWarehouse,
		ShipmentCost: 15000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: product, Sku: "SKU-CL", Name: "Widget", Count: 10, Total: 500000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	reqID := created.Msg.GetRequest().GetId()

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId:                      clWarehouse,
		RequestId:                   reqID,
		WarehouseAdditionalCost:     float64(amount),
		WarehouseAdditionalCostNote: note,
		Lines:                       allArrived(t, db, created.Msg.GetRequest()),
	}))

	return reqID, err
}

// TWO ASKS AT THE DOOR ARE ONE CHARGE — their sum, under one note (the-courier-is-paid-once-per-restock). Converted
// from "several cost lines on one delivery": the contract no longer holds a list, so the warehouse enters the sum.
func TestRestockAccept_RecordsTheOneCourierCharge(t *testing.T) {
	db := san_testdb.DB(t)
	poster := &recordingPoster{}
	svc := newServiceWithLiability(t, db, poster)

	// 25.000 for the courier and 5.000 for the porter, entered as one.
	reqID, err := acceptWithCosts(t, db, svc, clProduct, 30000, "courier at the door + porter at the gate")
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	stored := storedRestock(t, db, reqID)

	// The NOTE is what the team being charged reads. One charge, on the restock (00024).
	if stored.WarehouseAdditionalCost != 30000 ||
		stored.WarehouseAdditionalCostNote != "courier at the door + porter at the gate" {
		t.Fatalf("stored charge = %v %q, want 30000 with its note",
			stored.WarehouseAdditionalCost, stored.WarehouseAdditionalCostNote)
	}

	// WHO TYPED IT. A cost charged to another team with nobody's name on it is the first thing a dispute asks for:
	// the charge is entered at accept, so it is the accepting user's.
	if stored.AcceptedByUserID != 9 {
		t.Fatalf("the charge was accepted by %d, want the accepting user 9", stored.AcceptedByUserID)
	}

	// And it reads back as the restock's one charge, beside — not inside — the total.
	detail, err := svc.RestockRequestDetail(ctxUser(9), connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: clSellingTeam, RequestId: reqID,
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	got := detail.Msg.GetRequest()
	if got.GetWarehouseAdditionalCost() != 30000 ||
		got.GetWarehouseAdditionalCostNote() != "courier at the door + porter at the gate" {
		t.Fatalf("charge reads back as %v %q, want 30000 with its note",
			got.GetWarehouseAdditionalCost(), got.GetWarehouseAdditionalCostNote())
	}
}

// ⚠ THE SAME RUPIAH ANSWERS TWO QUESTIONS. The debt above must not have taken the money OUT of
// costing: the charge is freight, spread over the units that arrived sellable (the-couriers-ask-is-in-the-unit-price
// — outside the restock's total, inside the unit price).
//
//	(15.000 own freight + 30.000 courier's charge) / 10 units = 4.500 per unit
//	500.000 / 10 = 50.000 goods per unit  →  54.500 HPP
func TestRestockAccept_TheCourierChargeReachesTheHPP(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithLiability(t, db, &recordingPoster{})

	_, err := acceptWithCosts(t, db, svc, clProduct, 30000, "courier and porter")
	if err != nil {
		t.Fatalf("accept: %v", err)
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
		t.Fatalf("HPP = %d, want 54500 — a charge that raises a debt must also raise the cost",
			lines[0].GetUnitCost())
	}
}

// A CHARGE WITH NO NOTE IS REFUSED (an-incidental-line-must-say-what-it-was-for): an amount with no words beside it is a
// number the team being charged cannot argue with.
//
// ⚠ THE RULE MOVED BACK TO THE HANDLER, and this test moved with it. With cost lines it was unconditional and lived in
// the proto as `min_len: 1`. With one charge it is conditional — the note is required only ABOVE 0 — which is a rule
// across two fields that protovalidate cannot express, so the contract no longer refuses it and the handler does. The
// test asserts both halves: the contract lets it through, the handler stops it.
func TestRestockAccept_RefusesACostWithNoNote(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithLiability(t, db, &recordingPoster{})

	err := protovalidate.GlobalValidator.Validate(&inventoryv1.RestockRequestAcceptRequest{
		TeamId:                  1,
		RequestId:               1,
		WarehouseAdditionalCost: 5000,
		Lines:                   []*inventoryv1.RestockRequestReceivedLine{{ItemId: 1}},
	})
	if err != nil {
		t.Fatalf("the contract refused a charge with no note (%v) — the rule is the handler's now", err)
	}

	_, err = acceptWithCosts(t, db, svc, clProduct, 5000, "")
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("an unexplained charge = %v, want InvalidArgument", connect.CodeOf(err))
	}

	if !strings.Contains(err.Error(), "note") {
		t.Fatalf("refused for %v, want a complaint about the note", err)
	}
}

// A CHARGE THAT CANNOT BE TRUE IS REFUSED rather than stored. Converted from "an unknown cost kind" — the one charge
// has no kind any more, so the nearest unusable charge is a negative one, which the contract refuses (gte 0) before
// the handler ever sees it.
func TestRestockAccept_RefusesANegativeCharge(t *testing.T) {
	err := protovalidate.GlobalValidator.Validate(&inventoryv1.RestockRequestAcceptRequest{
		TeamId:                      1,
		RequestId:                   1,
		WarehouseAdditionalCost:     -5000,
		WarehouseAdditionalCostNote: "refund?",
		Lines:                       []*inventoryv1.RestockRequestReceivedLine{{ItemId: 1}},
	})
	if err == nil {
		t.Fatal("a negative courier's charge passed validation")
	}

	if !strings.Contains(err.Error(), "warehouse_additional_cost") {
		t.Fatalf("refused for %v, want a complaint about warehouse_additional_cost", err)
	}
}

// A REFUSED CHARGE LEAVES NOTHING BEHIND — the note check runs before the transaction, so a delivery is never
// half-received because of a missing word on the charge.
func TestRestockAccept_ARefusedCostLineReceivesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithLiability(t, db, &recordingPoster{})

	// The refusal the handler makes itself: a charge with no note.
	reqID, err := acceptWithCosts(t, db, svc, clProduct, 5000, "")
	if err == nil {
		t.Fatal("the acceptance succeeded with an unusable charge on it")
	}

	var stored inventory_service_models.Restock

	readErr := db.Where("id = ?", reqID).Take(&stored).Error
	if readErr != nil {
		t.Fatalf("read request: %v", readErr)
	}

	// ACCEPTED is still stored as `fulfilled`.
	if stored.Status == "accepted" {
		t.Fatal("the request was accepted despite the charge being refused")
	}

	var levels int64

	readErr = db.
		Model(&inventory_service_models.ProductPlacement{}).
		Where("warehouse_id = ?", clWarehouse).
		Count(&levels).
		Error
	if readErr != nil {
		t.Fatalf("count stock: %v", readErr)
	}

	if levels != 0 {
		t.Fatalf("%d rack rows landed on a refused acceptance", levels)
	}
}

// NO CHARGE AT ALL is the ordinary delivery: nothing is stored, and the event carries 0, so balance posts nothing.
func TestRestockAccept_NoCostsMeanNoObligationAndNoRows(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	reqID, err := acceptWithCosts(t, db, svc, clProduct, 0, "")
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	if charge := storedRestock(t, db, reqID).WarehouseAdditionalCost; charge != 0 {
		t.Fatalf("a charge of %v stored for a delivery that cost nothing", charge)
	}
}

// storedRestock is the restock row as the database holds it — not what an RPC chose to echo.
func storedRestock(t *testing.T, db *gorm.DB, reqID uint64) inventory_service_models.Restock {
	t.Helper()

	var rr inventory_service_models.Restock

	err := db.Where("id = ?", reqID).First(&rr).Error
	if err != nil {
		t.Fatalf("read restock %d: %v", reqID, err)
	}

	return rr
}
