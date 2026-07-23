package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The Info tab's tiles: Ready (on hand + value), Ongoing (a pending restock not yet accepted), and the
// last delivery id (#209).
func TestProductStockSummary_ReadyOngoingLast(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const warehouse, product uint64 = 5, 100

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}
	acceptOne(t, svc, warehouse, rack.Msg.GetRack().GetId(), product, 100, 4000000) // ready 100 @ 40.000

	// The last delivery id — the accepted restock.
	batches, err := svc.BatchList(ctx, connect.NewRequest(&inventoryv1.BatchListRequest{TeamId: warehouse, Page: page1(), ProductId: product}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}
	lastDelivery := batches.Msg.GetBatches()[0].GetDeliveryId()

	// A second restock, LEFT PENDING — this is the ongoing (inbound) stock.
	_, err = svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: warehouse, ShippingCode: "jne",
		Items: []*inventoryv1.RestockRequestItem{{ProductId: product, Sku: "S", Name: "P", Quantity: 50, TotalPrice: 2000000}},
	}))
	if err != nil {
		t.Fatalf("pending restock: %v", err)
	}

	res, err := svc.ProductStockSummary(context.Background(), connect.NewRequest(&inventoryv1.ProductStockSummaryRequest{
		TeamId: warehouse, ProductId: product,
	}))
	if err != nil {
		t.Fatalf("ProductStockSummary: %v", err)
	}
	msg := res.Msg

	if msg.GetReadyQty() != 100 || msg.GetReadyValue() != 4000000 {
		t.Fatalf("ready = %d/%d, want 100/4000000", msg.GetReadyQty(), msg.GetReadyValue())
	}
	if msg.GetOngoingQty() != 50 || msg.GetOngoingValueEst() != 2000000 {
		t.Fatalf("ongoing = %d/%d, want 50/2000000", msg.GetOngoingQty(), msg.GetOngoingValueEst())
	}
	if msg.GetLastRestockId() != lastDelivery {
		t.Fatalf("last_restock_id = %d, want %d", msg.GetLastRestockId(), lastDelivery)
	}
	// Nothing has been counted, so Last counted is empty.
	if msg.GetLastCountedUnix() != 0 {
		t.Fatalf("last_counted = %d, want 0 (never counted)", msg.GetLastCountedUnix())
	}
}
