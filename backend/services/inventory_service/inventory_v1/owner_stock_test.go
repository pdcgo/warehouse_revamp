package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// acceptOwnedBy is acceptOne with the REQUESTING team spelled out — the whole point of the owner
// reads is that this id decides whose stock it is.
func acceptOwnedBy(
	t *testing.T,
	svc *inventory_v1.Service,
	owner, warehouse, rackID, product uint64,
	qty, total int64,
) {
	t.Helper()

	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: owner, WarehouseId: warehouse, ShippingCode: "jne",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: product, Sku: "SKU", Name: "P", Quantity: qty, TotalPrice: total},
		},
	}))
	if err != nil {
		t.Fatalf("create restock: %v", err)
	}

	item := created.Msg.GetRequest().GetItems()[0]

	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: created.Msg.GetRequest().GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId:           item.GetId(),
			ReceivedQuantity: qty,
			Placements: []*inventoryv1.RestockPlacement{
				{Place: &inventoryv1.RestockPlacement_RackId{RackId: rackID}, Quantity: qty},
			},
		}},
	}))
	if err != nil {
		t.Fatalf("fulfil restock: %v", err)
	}
}

func newRack(t *testing.T, svc *inventory_v1.Service, warehouse uint64, code string) uint64 {
	t.Helper()

	rack, err := svc.RackCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RackCreateRequest{
		TeamId: warehouse, Code: code,
	}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}

	return rack.Msg.GetRack().GetId()
}

func ownerStock(
	t *testing.T,
	svc *inventory_v1.Service,
	owner, warehouse uint64,
	productIDs []uint64,
) map[uint64]*inventoryv1.OwnerStockItem {
	t.Helper()

	res, err := svc.OwnerStockByIds(context.Background(), connect.NewRequest(&inventoryv1.OwnerStockByIdsRequest{
		TeamId: owner,
		Filter: &inventoryv1.OwnerStockByIdsFilter{ProductIds: productIDs, WarehouseId: warehouse},
	}))
	if err != nil {
		t.Fatalf("OwnerStockByIds: %v", err)
	}

	out := map[uint64]*inventoryv1.OwnerStockItem{}

	for id, list := range res.Msg.GetItems() {
		for _, it := range list.GetItems() {
			stock := it.GetStock()
			if stock == nil {
				continue
			}

			row, ok := stock.GetMapData()[id]
			if ok {
				out[id] = row
			}
		}
	}

	return out
}

// The whole row, off two deliveries at different prices: ready and its value, the cost SPREAD, the
// oldest batch still on a shelf, when stock last arrived, and a pending restock as ongoing.
func TestOwnerStockByIds_ReadyOngoingSpread(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const owner, warehouse, product uint64 = 2, 5, 100

	rack := newRack(t, svc, warehouse, "A-01-3")

	acceptOwnedBy(t, svc, owner, warehouse, rack, product, 100, 4_000_000) // 40.000/pc
	acceptOwnedBy(t, svc, owner, warehouse, rack, product, 50, 1_250_000)  // 25.000/pc

	// Inbound: raised, not yet accepted.
	_, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: owner, WarehouseId: warehouse, ShippingCode: "jne",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: product, Sku: "SKU", Name: "P", Quantity: 30, TotalPrice: 900_000},
		},
	}))
	if err != nil {
		t.Fatalf("pending restock: %v", err)
	}

	row := ownerStock(t, svc, owner, 0, []uint64{product})[product]
	if row == nil {
		t.Fatalf("no row for the product the team owns")
	}

	if row.GetReadyQty() != 150 || row.GetReadyValue() != 5_250_000 {
		t.Fatalf("ready = %d/%d, want 150/5250000", row.GetReadyQty(), row.GetReadyValue())
	}
	if row.GetOngoingQty() != 30 || row.GetOngoingValueEst() != 900_000 {
		t.Fatalf("ongoing = %d/%d, want 30/900000", row.GetOngoingQty(), row.GetOngoingValueEst())
	}
	if !row.GetCostKnown() || row.GetCostMin() != 25_000 || row.GetCostMax() != 40_000 {
		t.Fatalf("cost spread = %d..%d (known=%v), want 25000..40000",
			row.GetCostMin(), row.GetCostMax(), row.GetCostKnown())
	}
	if row.GetOldestBatchUnix() == 0 {
		t.Fatalf("oldest batch unset while 150 units sit on a shelf")
	}
	if row.GetLastRestockUnix() < row.GetOldestBatchUnix() {
		t.Fatalf("last restock (%d) older than the oldest batch (%d)",
			row.GetLastRestockUnix(), row.GetOldestBatchUnix())
	}
}

// The ownership rule, which is the security property: stock is another team's unless it arrived on a
// restock THIS team raised. Passing somebody else's product id gets nothing, not their numbers.
func TestOwnerStockByIds_AnotherTeamsStockIsInvisible(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const mine, theirs, warehouse uint64 = 2, 3, 5
	const myProduct, theirProduct uint64 = 100, 200

	rack := newRack(t, svc, warehouse, "A-01-3")

	acceptOwnedBy(t, svc, mine, warehouse, rack, myProduct, 10, 100_000)
	acceptOwnedBy(t, svc, theirs, warehouse, rack, theirProduct, 999, 99_900_000)

	rows := ownerStock(t, svc, mine, 0, []uint64{myProduct, theirProduct})

	if rows[myProduct] == nil || rows[myProduct].GetReadyQty() != 10 {
		t.Fatalf("own product = %v, want 10 ready", rows[myProduct])
	}
	if rows[theirProduct] != nil {
		t.Fatalf("another team's stock leaked: %v", rows[theirProduct])
	}
}

// The warehouse LENS restates the figures as one building's, and the same call without it totals them.
func TestOwnerStockByIds_WarehouseLens(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const owner, jakarta, surabaya, product uint64 = 2, 5, 6, 100

	acceptOwnedBy(t, svc, owner, jakarta, newRack(t, svc, jakarta, "A-01-3"), product, 40, 1_600_000)
	acceptOwnedBy(t, svc, owner, surabaya, newRack(t, svc, surabaya, "B-02-1"), product, 60, 2_400_000)

	total := ownerStock(t, svc, owner, 0, []uint64{product})[product]
	if total.GetReadyQty() != 100 {
		t.Fatalf("total ready = %d, want 100", total.GetReadyQty())
	}

	one := ownerStock(t, svc, owner, jakarta, []uint64{product})[product]
	if one.GetReadyQty() != 40 || one.GetReadyValue() != 1_600_000 {
		t.Fatalf("jakarta ready = %d/%d, want 40/1600000", one.GetReadyQty(), one.GetReadyValue())
	}
}

// A product with nothing behind it is ABSENT rather than a row of zeros.
func TestOwnerStockByIds_NothingHeldIsAbsent(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rows := ownerStock(t, svc, 2, 0, []uint64{404})
	if len(rows) != 0 {
		t.Fatalf("rows = %v, want none", rows)
	}
}

// The stat totals the catalogue, follows the same ownership rule, and honours the lens.
func TestOwnerStockStat_TotalsAndLens(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const owner, theirs, jakarta, surabaya uint64 = 2, 3, 5, 6

	acceptOwnedBy(t, svc, owner, jakarta, newRack(t, svc, jakarta, "A-01-3"), 100, 40, 1_600_000)
	acceptOwnedBy(t, svc, owner, surabaya, newRack(t, svc, surabaya, "B-02-1"), 101, 60, 2_400_000)
	// Another team's goods in the same building — must not be counted.
	acceptOwnedBy(t, svc, theirs, jakarta, newRack(t, svc, jakarta, "A-02-1"), 300, 500, 50_000_000)

	_, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: owner, WarehouseId: jakarta, ShippingCode: "jne",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU", Name: "P", Quantity: 25, TotalPrice: 1_000_000},
		},
	}))
	if err != nil {
		t.Fatalf("pending restock: %v", err)
	}

	all, err := svc.OwnerStockStat(context.Background(), connect.NewRequest(&inventoryv1.OwnerStockStatRequest{
		TeamId: owner,
	}))
	if err != nil {
		t.Fatalf("OwnerStockStat: %v", err)
	}

	preview := all.Msg.GetPreview()
	if preview.GetReadyQty() != 100 || preview.GetReadyValue() != 4_000_000 {
		t.Fatalf("ready = %d/%d, want 100/4000000", preview.GetReadyQty(), preview.GetReadyValue())
	}
	if preview.GetOngoingQty() != 25 || preview.GetOngoingValueEst() != 1_000_000 {
		t.Fatalf("ongoing = %d/%d, want 25/1000000", preview.GetOngoingQty(), preview.GetOngoingValueEst())
	}
	if preview.GetLastRestockUnix() == 0 {
		t.Fatalf("last restock unset after two accepted deliveries")
	}

	lensed, err := svc.OwnerStockStat(context.Background(), connect.NewRequest(&inventoryv1.OwnerStockStatRequest{
		TeamId: owner,
		Filter: &inventoryv1.OwnerStockStatFilter{WarehouseId: surabaya},
	}))
	if err != nil {
		t.Fatalf("OwnerStockStat(lens): %v", err)
	}

	if lensed.Msg.GetPreview().GetReadyQty() != 60 {
		t.Fatalf("surabaya ready = %d, want 60", lensed.Msg.GetPreview().GetReadyQty())
	}
	// The pending restock is destined for Jakarta, so Surabaya has nothing inbound.
	if lensed.Msg.GetPreview().GetOngoingQty() != 0 {
		t.Fatalf("surabaya ongoing = %d, want 0", lensed.Msg.GetPreview().GetOngoingQty())
	}
}
