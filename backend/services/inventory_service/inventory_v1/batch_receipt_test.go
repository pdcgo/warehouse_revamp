package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// BatchReceipt is the whole delivery's goods-received document (#219): every product line, with
// accepted = arrived − damaged, the put-away rack, the two actors, and the totals. A delivery of
// another warehouse reads NotFound.
func TestBatchReceipt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const warehouse uint64 = 5

	// GRN-0721: Kaos (100 arrived, all accepted, on rack A) and Topi (30 arrived, 2 damaged, 28
	// accepted, unplaced).
	req := seedTwoBatches(t, svc, warehouse)
	deliveryID := req.GetId()

	res, err := svc.BatchReceipt(context.Background(), connect.NewRequest(&inventoryv1.BatchReceiptRequest{
		TeamId:     warehouse,
		DeliveryId: deliveryID,
	}))
	if err != nil {
		t.Fatalf("BatchReceipt: %v", err)
	}
	msg := res.Msg

	if msg.GetReceiptNo() != "GRN-0721" {
		t.Errorf("receipt = %q, want GRN-0721", msg.GetReceiptNo())
	}
	if len(msg.GetLines()) != 2 {
		t.Fatalf("%d lines, want 2 (one per product on the delivery)", len(msg.GetLines()))
	}

	byProduct := make(map[uint64]*inventoryv1.BatchReceiptLine)
	for _, l := range msg.GetLines() {
		byProduct[l.GetProductId()] = l
	}

	// Kaos — nothing broken, everything accepted, on a real shelf.
	kaos := byProduct[100]
	if kaos.GetArrived() != 100 || kaos.GetDamaged() != 0 || kaos.GetAccepted() != 100 {
		t.Errorf("kaos arrived/damaged/accepted = %d/%d/%d, want 100/0/100",
			kaos.GetArrived(), kaos.GetDamaged(), kaos.GetAccepted())
	}
	if !kaos.GetCostKnown() || kaos.GetLineCost() != kaos.GetArrived()*kaos.GetUnitCost() {
		t.Errorf("kaos cost: known=%v line=%d unit=%d", kaos.GetCostKnown(), kaos.GetLineCost(), kaos.GetUnitCost())
	}
	if len(kaos.GetRackIds()) == 0 || kaos.GetRackIds()[0] == 0 {
		t.Errorf("kaos should sit on a real rack, got %v", kaos.GetRackIds())
	}

	// Topi — 2 broke and never entered stock; the 28 accepted are unplaced (rack 0).
	topi := byProduct[200]
	if topi.GetArrived() != 30 || topi.GetDamaged() != 2 || topi.GetAccepted() != 28 {
		t.Errorf("topi arrived/damaged/accepted = %d/%d/%d, want 30/2/28",
			topi.GetArrived(), topi.GetDamaged(), topi.GetAccepted())
	}
	if len(topi.GetRackIds()) != 1 || topi.GetRackIds()[0] != 0 {
		t.Errorf("topi should be unplaced (rack 0), got %v", topi.GetRackIds())
	}

	// Totals: accepted 100 + 28 = 128; value is the sum of the known-cost line costs.
	if msg.GetTotalAccepted() != 128 {
		t.Errorf("total accepted = %d, want 128", msg.GetTotalAccepted())
	}
	if msg.GetTotalValue() != kaos.GetLineCost()+topi.GetLineCost() {
		t.Errorf("total value = %d, want %d", msg.GetTotalValue(), kaos.GetLineCost()+topi.GetLineCost())
	}

	// Accepted-by is captured at fulfil (the person who accepted the delivery). Created-by (who RAISED
	// the restock) is not captured in the model yet, so it comes back 0 and the screen shows "—".
	if msg.GetAcceptedBy() == 0 {
		t.Errorf("accepted_by missing: %d", msg.GetAcceptedBy())
	}
	if msg.GetWarehouseId() != warehouse {
		t.Errorf("warehouse = %d, want %d", msg.GetWarehouseId(), warehouse)
	}

	// Another warehouse cannot read this delivery's receipt by id.
	_, err = svc.BatchReceipt(context.Background(), connect.NewRequest(&inventoryv1.BatchReceiptRequest{
		TeamId:     999,
		DeliveryId: deliveryID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("cross-warehouse read: got %v, want NotFound", err)
	}
}
