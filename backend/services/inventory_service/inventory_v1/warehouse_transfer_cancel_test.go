package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

func cancelTransfer(f *wtFixture, team, id uint64) (*inventoryv1.WarehouseTransfer, error) {
	res, err := f.svc.WarehouseTransferCancel(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.WarehouseTransferCancelRequest{
		TeamId: team, TransferId: id, Description: "wrong warehouse",
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetTransfer(), nil
}

// Called off while created: every unit goes back to the batch and the rack it left, once
// (cancel-before-processed-lost-only-in-transit, a-rollback-reverses-its-log-rows), and the trip's money comes back.
func TestWarehouseTransferCancel_RollsTheOutLegBack(t *testing.T) {
	f := wtStocked(t)

	res, err := f.svc.WarehouseTransferCreate(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
		TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB, ShipmentCost: 18000, FinanceAccountId: wtAccount,
		Lines: []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosHitam, 4)},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	tr := res.Msg.GetTransfer()

	cancelled, err := cancelTransfer(f, otMelati, tr.GetId())
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	if cancelled.GetStatus() != inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_CANCELLED ||
		cancelled.GetCancelledByUserId() != wtSeller {
		t.Fatalf("transfer = %v by %d, want cancelled by %d", cancelled.GetStatus(), cancelled.GetCancelledByUserId(), wtSeller)
	}

	if b, r := unitsAt(t, f.db, wtA, wtKaosHitam); b != 7 || r != 7 {
		t.Fatalf("A holds %d / %d Kaos Hitam after the cancel, want all 7 back", b, r)
	}

	var rack int64
	f.db.Raw(`SELECT stock_count FROM product_placements WHERE product_id = ? AND placement_id = ?`, wtKaosHitam, f.rakA).Scan(&rack)
	if rack != 3 {
		t.Fatalf("Rak A holds %d Kaos Hitam, want its 3 back", rack)
	}

	var leg models.InventoryTransaction
	f.db.First(&leg, tr.GetOutboundTransactionId())
	if !leg.IsRollback {
		t.Fatalf("the out-leg is not marked rolled back")
	}

	logs := cancelled.GetLogs()
	if len(logs) != 2 || logs[1].GetDescription() != "wrong warehouse" ||
		logs[1].GetFromStatus() != inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_CREATED ||
		logs[1].GetToStatus() != inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_CANCELLED {
		t.Fatalf("trail = %+v, want created, then created → cancel with its reason", logs)
	}

	events := f.transferEvents()
	got := events[len(events)-1].GetWarehouseTransferCancelled()
	if got == nil || got.GetAmount() != 18000 || got.GetFinanceAccountId() != wtAccount || got.GetActorId() != wtSeller {
		t.Fatalf("last event = %+v, want the 18000 back to account 77", events[len(events)-1])
	}
}

// Once A confirmed there is no cancel, and only the owning team cancels — anyone else reads NotFound.
func TestWarehouseTransferCancel_OnlyTheOwnerWhileCreated(t *testing.T) {
	f := wtStocked(t)
	tr := f.create(t, wtLine(wtKaosHitam, 2))

	_, err := cancelTransfer(f, wtA, tr.GetId())
	wantCode(t, err, connect.CodeNotFound, "cancelled by A")

	f.process(t, tr.GetId())

	_, err = cancelTransfer(f, otMelati, tr.GetId())
	wantCode(t, err, connect.CodeFailedPrecondition, "cancelled while process")

	if b, _ := unitsAt(t, f.db, wtA, wtKaosHitam); b != 5 {
		t.Fatalf("A holds %d Kaos Hitam, want 5 — a refused cancel returned stock", b)
	}
}
