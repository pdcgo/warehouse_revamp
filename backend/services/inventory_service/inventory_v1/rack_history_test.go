package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A SHELF'S HISTORY READS THE OVERRIDE STAMP (an-override-shows-a-platform-badge): the rack page's By column carries the
// "by Root team" badge on the stock-in Root made from outside the warehouse, and not on the staff's.
func TestRackHistory_ReadsTheOverrideStamp(t *testing.T) {
	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, otFacts(), nil, nil, nil, nil)
	rack := newRack(t, svc, otWarehouse, "rak-a")

	// Root raises the first and the warehouse's staff count it in; the seller raises the second and Root, from outside
	// the warehouse, counts it in — so one stock-in transaction is the staff's and the other an override.
	restockAs(t, svc, ctxAs(ovRoot, otMelati, rootOutsideRole), ctxAs(31, otWarehouse, staffRole), rack)
	restockAs(t, svc, ctxAs(8, otMelati, sellerRole), ctxAs(ovRoot, otWarehouse, rootOutsideRole), rack)

	res, err := svc.RackHistory(ctxUser(1), connect.NewRequest(&inventoryv1.RackHistoryRequest{
		TeamId: otWarehouse, Filter: &inventoryv1.RackHistoryFilter{RackId: rack}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackHistory: %v", err)
	}

	var (
		actors    []uint64
		overrides []bool
	)

	for _, m := range rackHistoryRows(res.Msg) {
		actors = append(actors, m.GetActorUserId())
		overrides = append(overrides, m.GetIsOverride())
	}

	wantOverrideByActor(t, "RackHistory", actors, overrides)
}

// A SAMPLE'S RECIPIENT ON THE SHELF'S HISTORY (a-sample-keeps-its-recipient; the acceptance's *sample in the rack's
// history with who received it*): the sample row names who the units were handed to — the transaction's `recipient`,
// never folded into the staff's note — and every other row names nobody. The same row reads the same on the product's
// history and the batch's: one StockMovement, one reading.
func TestRackHistory_ASampleRowNamesWhoReceivedIt(t *testing.T) {
	svc, db, _, rakB := otStocked(t)

	sampled, err := svc.RackSample(ctxUser(8), connect.NewRequest(&inventoryv1.RackSampleRequest{
		TeamId: otWarehouse, RackId: rakB, Recipient: "Pak Budi", Description: "for a review video",
		Lines: []*inventoryv1.RackSampleLine{{ProductId: otKaosPolos, Quantity: 1}},
	}))
	if err != nil {
		t.Fatalf("sample: %v", err)
	}

	txID := sampled.Msg.GetTransactions()[0].GetTransactionId()

	// Each read's rows: the sample's names Pak Budi and keeps the note apart; the restock's rows name nobody.
	check := func(read string, rows []*inventoryv1.StockMovement) {
		t.Helper()

		samples := 0

		for _, m := range rows {
			if m.GetKind() != inventoryv1.MovementKind_MOVEMENT_KIND_SAMPLE {
				if m.GetRecipient() != "" {
					t.Fatalf("%s: a %s row names %q, want nobody — only a sample has a recipient", read, m.GetKind(), m.GetRecipient())
				}

				continue
			}

			samples++

			if m.GetRecipient() != "Pak Budi" || m.GetReason() != "for a review video" {
				t.Fatalf("%s: the sample row = recipient %q, reason %q — want Pak Budi, and the note on its own",
					read, m.GetRecipient(), m.GetReason())
			}
		}

		if samples != 1 || len(rows) < 2 {
			t.Fatalf("%s: %d sample rows of %d, want the one sample beside the restock", read, samples, len(rows))
		}
	}

	rack, err := svc.RackHistory(ctxUser(8), connect.NewRequest(&inventoryv1.RackHistoryRequest{
		TeamId: otWarehouse, Filter: &inventoryv1.RackHistoryFilter{RackId: rakB}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackHistory: %v", err)
	}

	check("the rack's history", rackHistoryRows(rack.Msg))

	product, err := svc.StockHistory(ctxUser(8), connect.NewRequest(&inventoryv1.StockHistoryRequest{
		WarehouseId: otWarehouse, Filter: &inventoryv1.StockHistoryFilter{ProductId: otKaosPolos}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockHistory: %v", err)
	}

	check("the product's history", stockHistoryRows(product.Msg))

	var batchID uint64

	err = db.
		Model(&models.BatchLog{}).
		Where("transaction_id = ?", txID).
		Pluck("batch_id", &batchID).
		Error
	if err != nil || batchID == 0 {
		t.Fatalf("the sampled batch: %d, %v", batchID, err)
	}

	batch, err := svc.StockHistory(ctxUser(8), connect.NewRequest(&inventoryv1.StockHistoryRequest{
		WarehouseId: otWarehouse,
		Filter:      &inventoryv1.StockHistoryFilter{ProductId: otKaosPolos, BatchId: batchID},
		Page:        page1(),
	}))
	if err != nil {
		t.Fatalf("StockHistory (batch): %v", err)
	}

	check("the batch's history", stockHistoryRows(batch.Msg))
}
