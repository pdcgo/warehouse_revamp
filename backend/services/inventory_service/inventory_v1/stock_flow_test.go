package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

const (
	warehouseA = 100
	warehouseB = 200
	productX   = 300
)

// Receive raises on-hand, and StockList reads the derived snapshot back.
func TestStockReceive_ThenList(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	_, err := svc.StockReceive(ctx, connect.NewRequest(&inventoryv1.StockReceiveRequest{
		WarehouseId: warehouseA, ProductId: productX, Quantity: 100,
	}))
	if err != nil {
		t.Fatalf("StockReceive: %v", err)
	}

	_, err = svc.StockReceive(ctx, connect.NewRequest(&inventoryv1.StockReceiveRequest{
		WarehouseId: warehouseA, ProductId: productX, Quantity: 40,
	}))
	if err != nil {
		t.Fatalf("StockReceive 2: %v", err)
	}

	res, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{
		WarehouseId: warehouseA, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}

	if len(res.Msg.GetLevels()) != 1 {
		t.Fatalf("levels = %d, want 1", len(res.Msg.GetLevels()))
	}

	if got := res.Msg.GetLevels()[0].GetOnHand(); got != 140 {
		t.Errorf("on_hand = %d, want 140", got)
	}
}

// The ledger records every movement newest-first with a running balance.
func TestStockHistory_RunningBalance(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	receive(t, svc, ctx, warehouseA, productX, 100)
	receive(t, svc, ctx, warehouseA, productX, 25)

	res, err := svc.StockHistory(ctx, connect.NewRequest(&inventoryv1.StockHistoryRequest{
		WarehouseId: warehouseA, ProductId: productX, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockHistory: %v", err)
	}

	movements := res.Msg.GetMovements()
	if len(movements) != 2 {
		t.Fatalf("movements = %d, want 2", len(movements))
	}

	// Newest first: the +25 with balance 125, then the +100 with balance 100.
	if movements[0].GetDelta() != 25 || movements[0].GetBalance() != 125 {
		t.Errorf("latest = (delta %d, balance %d), want (25, 125)", movements[0].GetDelta(), movements[0].GetBalance())
	}

	if movements[1].GetDelta() != 100 || movements[1].GetBalance() != 100 {
		t.Errorf("first = (delta %d, balance %d), want (100, 100)", movements[1].GetDelta(), movements[1].GetBalance())
	}
}

// Adjust corrects on-hand to a counted figure and records the difference.
func TestStockAdjust_ToCountedFigure(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	receive(t, svc, ctx, warehouseA, productX, 100)

	res, err := svc.StockAdjust(ctx, connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouseA, ProductId: productX, OnHand: 90, Reason: "cycle count",
	}))
	if err != nil {
		t.Fatalf("StockAdjust: %v", err)
	}

	if got := res.Msg.GetLevel().GetOnHand(); got != 90 {
		t.Errorf("level on_hand = %d, want 90", got)
	}

	// The correction is recorded as a −10 movement.
	if got := res.Msg.GetMovement().GetDelta(); got != -10 {
		t.Errorf("adjust delta = %d, want -10", got)
	}
}

// Transfer moves stock between warehouses: source down, destination up, atomically.
func TestStockTransfer_MovesBetweenWarehouses(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	receive(t, svc, ctx, warehouseA, productX, 100)

	_, err := svc.StockTransfer(ctx, connect.NewRequest(&inventoryv1.StockTransferRequest{
		FromWarehouseId: warehouseA, ToWarehouseId: warehouseB, ProductId: productX, Quantity: 30,
	}))
	if err != nil {
		t.Fatalf("StockTransfer: %v", err)
	}

	if got := onHand(t, svc, ctx, warehouseA, productX); got != 70 {
		t.Errorf("source on_hand = %d, want 70", got)
	}

	if got := onHand(t, svc, ctx, warehouseB, productX); got != 30 {
		t.Errorf("dest on_hand = %d, want 30", got)
	}
}

// An over-draw is refused (FailedPrecondition) and nothing moves — the CHECK rolls back the tx.
func TestStockTransfer_OverdrawRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	receive(t, svc, ctx, warehouseA, productX, 10)

	_, err := svc.StockTransfer(ctx, connect.NewRequest(&inventoryv1.StockTransferRequest{
		FromWarehouseId: warehouseA, ToWarehouseId: warehouseB, ProductId: productX, Quantity: 50,
	}))
	if err == nil {
		t.Fatal("StockTransfer over-draw = nil error, want FailedPrecondition")
	}

	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	// Neither side moved: source still 10, dest still absent (0).
	if got := onHand(t, svc, ctx, warehouseA, productX); got != 10 {
		t.Errorf("source on_hand = %d, want 10 (unchanged)", got)
	}

	if got := onHand(t, svc, ctx, warehouseB, productX); got != 0 {
		t.Errorf("dest on_hand = %d, want 0 (no move)", got)
	}
}

func TestStockTransfer_SameWarehouseRejected(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	_, err := svc.StockTransfer(ctx, connect.NewRequest(&inventoryv1.StockTransferRequest{
		FromWarehouseId: warehouseA, ToWarehouseId: warehouseA, ProductId: productX, Quantity: 5,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

// --- helpers ---

func receive(
	t *testing.T,
	svc *inventory_v1.Service,
	ctx context.Context,
	warehouseID, productID uint64,
	qty int64,
) {
	t.Helper()

	_, err := svc.StockReceive(ctx, connect.NewRequest(&inventoryv1.StockReceiveRequest{
		WarehouseId: warehouseID, ProductId: productID, Quantity: qty,
	}))
	if err != nil {
		t.Fatalf("receive %d: %v", qty, err)
	}
}

// onHand reads a product's on-hand at a warehouse via StockList (0 if there is no level row).
func onHand(
	t *testing.T,
	svc *inventory_v1.Service,
	ctx context.Context,
	warehouseID, productID uint64,
) int64 {
	t.Helper()

	res, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{
		WarehouseId: warehouseID, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}

	for _, level := range res.Msg.GetLevels() {
		if level.GetProductId() == productID {
			return level.GetOnHand()
		}
	}

	return 0
}
