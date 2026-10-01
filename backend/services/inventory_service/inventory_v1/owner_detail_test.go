package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// The three ROW-level owner reads behind the product detail's Price, Batch and Stock history tabs
// (#232). What every one of them is really being tested for is the same thing: that the answer is
// derived from what the caller OWNS, not from the building it happens to sit in.

func ownerLayers(
	t *testing.T,
	svc *inventory_v1.Service,
	owner, product, warehouse uint64,
) ([]*inventoryv1.CostLayer, int64) {
	t.Helper()

	res, err := svc.OwnerCostLayerList(context.Background(), connect.NewRequest(&inventoryv1.OwnerCostLayerListRequest{
		TeamId: owner,
		Filter: &inventoryv1.OwnerCostLayerListFilter{ProductId: product, WarehouseId: warehouse},
		Page:   page1(),
	}))
	if err != nil {
		t.Fatalf("OwnerCostLayerList: %v", err)
	}

	out := make([]*inventoryv1.CostLayer, 0, len(res.Msg.GetIds()))

	for _, item := range res.Msg.GetItems() {
		layer := item.GetLayer()
		if layer == nil {
			continue
		}

		// ids carries the order; the map is keyed by 1-based position.
		for _, id := range res.Msg.GetIds() {
			row, ok := layer.GetMapData()[id]
			if ok {
				out = append(out, row)
			}
		}
	}

	return out, res.Msg.GetTotalValue()
}

func ownerBatches(
	t *testing.T,
	svc *inventory_v1.Service,
	owner, product, warehouse uint64,
) []*inventoryv1.StockBatch {
	t.Helper()

	res, err := svc.OwnerBatchList(context.Background(), connect.NewRequest(&inventoryv1.OwnerBatchListRequest{
		TeamId: owner,
		Filter: &inventoryv1.OwnerBatchListFilter{ProductId: product, WarehouseId: warehouse},
		Page:   page1(),
	}))
	if err != nil {
		t.Fatalf("OwnerBatchList: %v", err)
	}

	out := make([]*inventoryv1.StockBatch, 0, len(res.Msg.GetIds()))

	for _, item := range res.Msg.GetItems() {
		batch := item.GetBatch()
		if batch == nil {
			continue
		}

		for _, id := range res.Msg.GetIds() {
			row, ok := batch.GetMapData()[id]
			if ok {
				out = append(out, row)
			}
		}
	}

	return out
}

func ownerHistory(
	t *testing.T,
	svc *inventory_v1.Service,
	owner, product, warehouse uint64,
) []*inventoryv1.OwnerMovement {
	t.Helper()

	res, err := svc.OwnerStockHistory(context.Background(), connect.NewRequest(&inventoryv1.OwnerStockHistoryRequest{
		TeamId: owner,
		Filter: &inventoryv1.OwnerStockHistoryFilter{ProductId: product, WarehouseId: warehouse},
		Page:   page1(),
	}))
	if err != nil {
		t.Fatalf("OwnerStockHistory: %v", err)
	}

	out := make([]*inventoryv1.OwnerMovement, 0, len(res.Msg.GetIds()))

	for _, item := range res.Msg.GetItems() {
		mv := item.GetMovement()
		if mv == nil {
			continue
		}

		// Newest first — ids carries that order.
		for _, id := range res.Msg.GetIds() {
			row, ok := mv.GetMapData()[id]
			if ok {
				out = append(out, row)
			}
		}
	}

	return out
}

// ── Price ────────────────────────────────────────────────────────────────────────────────────────

// Two deliveries at different prices are two layers, dearest first, and the header values both.
func TestOwnerCostLayerList_GroupsByFrozenCost(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const owner, warehouse, product uint64 = 2, 5, 100

	rack := newRack(t, svc, warehouse, "A-01-3")

	acceptOwnedBy(t, svc, owner, warehouse, rack, product, 100, 4_000_000) // 40.000/pc
	acceptOwnedBy(t, svc, owner, warehouse, rack, product, 50, 1_250_000)  // 25.000/pc

	layers, totalValue := ownerLayers(t, svc, owner, product, warehouse)

	if len(layers) != 2 {
		t.Fatalf("layers = %d, want 2", len(layers))
	}

	if layers[0].GetUnitCost() != 40_000 || layers[0].GetOnHand() != 100 {
		t.Errorf("dearest layer = %d × %d, want 40000 × 100",
			layers[0].GetUnitCost(), layers[0].GetOnHand())
	}

	if layers[1].GetUnitCost() != 25_000 || layers[1].GetOnHand() != 50 {
		t.Errorf("cheaper layer = %d × %d, want 25000 × 50",
			layers[1].GetUnitCost(), layers[1].GetOnHand())
	}

	// 100 × 40.000 + 50 × 25.000
	if totalValue != 5_250_000 {
		t.Errorf("total_value = %d, want 5250000", totalValue)
	}
}

// The lens is a lens, not the scope: with it open the owner's layers span every building, and each
// building on its own is a strict subset. This is the figure a selling team buys against.
func TestOwnerCostLayerList_WarehouseLens(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const owner, jakarta, surabaya, product uint64 = 2, 5, 6, 100

	acceptOwnedBy(t, svc, owner, jakarta, newRack(t, svc, jakarta, "A-01-3"), product, 100, 4_000_000)
	acceptOwnedBy(t, svc, owner, surabaya, newRack(t, svc, surabaya, "B-02-1"), product, 40, 1_600_000)

	all, allValue := ownerLayers(t, svc, owner, product, 0)

	// Same price in both buildings, so the open lens is ONE layer of 140 — not two rows that happen
	// to share a number.
	if len(all) != 1 || all[0].GetOnHand() != 140 {
		t.Fatalf("every warehouse = %d layers, on_hand %v, want 1 layer of 140",
			len(all), all)
	}

	if allValue != 5_600_000 {
		t.Errorf("total_value across warehouses = %d, want 5600000", allValue)
	}

	one, oneValue := ownerLayers(t, svc, owner, product, surabaya)

	if len(one) != 1 || one[0].GetOnHand() != 40 {
		t.Fatalf("surabaya = %v, want one layer of 40", one)
	}

	if oneValue != 1_600_000 {
		t.Errorf("surabaya total_value = %d, want 1600000", oneValue)
	}
}

// The authorization IS the join. Another team asking about this product joins to none of its rows.
func TestOwnerCostLayerList_AnotherTeamGetsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const owner, stranger, warehouse, product uint64 = 2, 3, 5, 100

	acceptOwnedBy(t, svc, owner, warehouse, newRack(t, svc, warehouse, "A-01-3"), product, 100, 4_000_000)

	layers, totalValue := ownerLayers(t, svc, stranger, product, warehouse)

	if len(layers) != 0 || totalValue != 0 {
		t.Errorf("stranger saw %d layers worth %d, want none", len(layers), totalValue)
	}
}

// ── Batch ────────────────────────────────────────────────────────────────────────────────────────

// An owner's deliveries are not a fact about a building: both land in one list, each saying which
// warehouse it is in, and the lens narrows to one.
func TestOwnerBatchList_SpansWarehousesAndNamesThem(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const owner, jakarta, surabaya, product uint64 = 2, 5, 6, 100

	acceptOwnedBy(t, svc, owner, jakarta, newRack(t, svc, jakarta, "A-01-3"), product, 100, 4_000_000)
	acceptOwnedBy(t, svc, owner, surabaya, newRack(t, svc, surabaya, "B-02-1"), product, 40, 1_600_000)

	all := ownerBatches(t, svc, owner, product, 0)

	if len(all) != 2 {
		t.Fatalf("batches = %d, want 2", len(all))
	}

	seen := map[uint64]int64{}
	for _, b := range all {
		if b.GetWarehouseId() == 0 {
			t.Errorf("batch %d has no warehouse — the column the owner reads it by", b.GetId())
		}

		seen[b.GetWarehouseId()] = b.GetReady()
	}

	if seen[jakarta] != 100 || seen[surabaya] != 40 {
		t.Errorf("ready by warehouse = %v, want jakarta 100 / surabaya 40", seen)
	}

	one := ownerBatches(t, svc, owner, product, surabaya)

	if len(one) != 1 || one[0].GetWarehouseId() != surabaya {
		t.Errorf("lens = %d rows, want the one surabaya delivery", len(one))
	}
}

func TestOwnerBatchList_AnotherTeamGetsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const owner, stranger, warehouse, product uint64 = 2, 3, 5, 100

	acceptOwnedBy(t, svc, owner, warehouse, newRack(t, svc, warehouse, "A-01-3"), product, 100, 4_000_000)

	if rows := ownerBatches(t, svc, stranger, product, warehouse); len(rows) != 0 {
		t.Errorf("stranger saw %d deliveries, want none", len(rows))
	}
}

// ── Stock history ────────────────────────────────────────────────────────────────────────────────

// The tab's whole purpose: a delivery in, a pick out, and a running balance that explains the number
// on the Info tab.
//
// The PICK is the interesting half — it is written with no batch (stock_pick.go), so the restock chain
// cannot reach it and it only appears at all because a batch-less movement belongs to whoever owns
// stock of that product in that building.
func TestOwnerStockHistory_RunningBalanceAcrossReceiveAndPick(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const owner, warehouse, product uint64 = 2, 5, 100

	rack := newRack(t, svc, warehouse, "A-01-3")

	acceptOwnedBy(t, svc, owner, warehouse, rack, product, 100, 4_000_000)

	_, err := svc.StockPick(ctxUser(1), connect.NewRequest(&inventoryv1.StockPickRequest{
		TeamId: owner, WarehouseId: warehouse, Ref: "ORD-1",
		Lines: []*inventoryv1.StockPickLine{{ProductId: product, Quantity: 30}},
	}))
	if err != nil {
		t.Fatalf("StockPick: %v", err)
	}

	rows := ownerHistory(t, svc, owner, product, warehouse)

	if len(rows) != 2 {
		t.Fatalf("history = %d rows, want 2 (the delivery and the pick)", len(rows))
	}

	// Newest first.
	if rows[0].GetDelta() != -30 || rows[0].GetBalance() != 70 {
		t.Errorf("pick = %+d leaving %d, want -30 leaving 70",
			rows[0].GetDelta(), rows[0].GetBalance())
	}

	if rows[0].GetBatchId() != 0 {
		t.Errorf("pick names batch %d — it is written batch-less", rows[0].GetBatchId())
	}

	if rows[1].GetDelta() != 100 || rows[1].GetBalance() != 100 {
		t.Errorf("receive = %+d leaving %d, want 100 leaving 100",
			rows[1].GetDelta(), rows[1].GetBalance())
	}

	if rows[1].GetBatchId() == 0 {
		t.Error("receive has no batch — it arrived on one")
	}
}

// A shelf-to-shelf move changes where a building's stock sits and nothing the owner holds, so it never
// reaches this ledger. Projecting it would also put a −q/+q pair in the middle of the running balance.
func TestOwnerStockHistory_ExcludesShelfMoves(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const owner, warehouse, product uint64 = 2, 5, 100

	from := newRack(t, svc, warehouse, "A-01-3")
	to := newRack(t, svc, warehouse, "A-01-4")

	acceptOwnedBy(t, svc, owner, warehouse, from, product, 100, 4_000_000)

	_, err := svc.StockMove(ctxUser(1), connect.NewRequest(&inventoryv1.StockMoveRequest{
		WarehouseId: warehouse, ProductId: product, Quantity: 40,
		From: &inventoryv1.StockPlace{Place: &inventoryv1.StockPlace_RackId{RackId: from}},
		To:   &inventoryv1.StockPlace{Place: &inventoryv1.StockPlace_RackId{RackId: to}},
	}))
	if err != nil {
		t.Fatalf("StockMove: %v", err)
	}

	rows := ownerHistory(t, svc, owner, product, warehouse)

	if len(rows) != 1 {
		t.Fatalf("history = %d rows, want only the delivery", len(rows))
	}

	if rows[0].GetBalance() != 100 {
		t.Errorf("balance after a move that changed nothing = %d, want 100", rows[0].GetBalance())
	}
}

// The lens partitions the running balance. Two buildings are two histories that happen to be read
// together — never one total, which no order could ever be filled from.
func TestOwnerStockHistory_BalanceIsPerWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const owner, jakarta, surabaya, product uint64 = 2, 5, 6, 100

	acceptOwnedBy(t, svc, owner, jakarta, newRack(t, svc, jakarta, "A-01-3"), product, 100, 4_000_000)
	acceptOwnedBy(t, svc, owner, surabaya, newRack(t, svc, surabaya, "B-02-1"), product, 40, 1_600_000)

	rows := ownerHistory(t, svc, owner, product, 0)

	if len(rows) != 2 {
		t.Fatalf("history = %d rows, want 2", len(rows))
	}

	for _, r := range rows {
		want := int64(100)
		if r.GetWarehouseId() == surabaya {
			want = 40
		}

		if r.GetBalance() != want {
			t.Errorf("warehouse %d balance = %d, want %d (its own, not the pair's 140)",
				r.GetWarehouseId(), r.GetBalance(), want)
		}
	}
}

func TestOwnerStockHistory_AnotherTeamGetsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const owner, stranger, warehouse, product uint64 = 2, 3, 5, 100

	acceptOwnedBy(t, svc, owner, warehouse, newRack(t, svc, warehouse, "A-01-3"), product, 100, 4_000_000)

	if rows := ownerHistory(t, svc, stranger, product, warehouse); len(rows) != 0 {
		t.Errorf("stranger saw %d movements, want none", len(rows))
	}
}

// ── The draw must reach the BATCHES, not only the shelf (#232) ───────────────────────────────────

// A pick moved `stock_levels` and left `stock_shelf_batches` untouched, so every batch kept its
// arrival quantity as Ready forever. Found by reading the two numbers side by side in the running app:
// the ledger said 120 on hand and the cost layers still totalled 150.
//
// It was never an owner-side bug — the warehouse's own Prices and Batches tabs read the same figure —
// which is why this test asserts on BOTH sides of the same shelf.
func TestStockPick_DrawsDownTheBatchesItTook(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const owner, warehouse, product uint64 = 2, 5, 100

	rack := newRack(t, svc, warehouse, "A-01-3")

	acceptOwnedBy(t, svc, owner, warehouse, rack, product, 100, 4_000_000) // 40.000/pc, oldest
	acceptOwnedBy(t, svc, owner, warehouse, rack, product, 50, 1_250_000)  // 25.000/pc

	_, err := svc.StockPick(ctxUser(1), connect.NewRequest(&inventoryv1.StockPickRequest{
		TeamId: owner, WarehouseId: warehouse, Ref: "ORD-1",
		Lines: []*inventoryv1.StockPickLine{{ProductId: product, Quantity: 30}},
	}))
	if err != nil {
		t.Fatalf("StockPick: %v", err)
	}

	// FIFO: the 30 come off the OLDEST batch, so the dear layer drops to 70 and the cheap one is
	// untouched. Total ready 120 — the same number the ledger's running balance reports.
	layers, totalValue := ownerLayers(t, svc, owner, product, warehouse)

	if len(layers) != 2 {
		t.Fatalf("layers = %d, want 2", len(layers))
	}

	if layers[0].GetOnHand() != 70 {
		t.Errorf("oldest layer after picking 30 = %d, want 70", layers[0].GetOnHand())
	}

	if layers[1].GetOnHand() != 50 {
		t.Errorf("untouched layer = %d, want 50", layers[1].GetOnHand())
	}

	// 70 × 40.000 + 50 × 25.000
	if totalValue != 4_050_000 {
		t.Errorf("total_value = %d, want 4050000", totalValue)
	}

	// The batch row must agree, and `used` must show the units that shipped — it is
	// arrived − damaged − ready, so a Ready that never moves reports 0 used for goods long gone.
	batches := ownerBatches(t, svc, owner, product, warehouse)

	var oldest *inventoryv1.StockBatch
	for _, b := range batches {
		if oldest == nil || b.GetId() < oldest.GetId() {
			oldest = b
		}
	}

	if oldest.GetReady() != 70 || oldest.GetUsed() != 30 {
		t.Errorf("oldest batch = %d ready / %d used, want 70 / 30",
			oldest.GetReady(), oldest.GetUsed())
	}
}

// Putting a cancelled order's stock back must reach the batches too, or the shelf ends up holding more
// units than its batches account for — the same drift, pointing the other way.
func TestStockReturn_PutsTheUnitsBackOnTheBatch(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const owner, warehouse, product uint64 = 2, 5, 100

	rack := newRack(t, svc, warehouse, "A-01-3")

	acceptOwnedBy(t, svc, owner, warehouse, rack, product, 100, 4_000_000)

	_, err := svc.StockPick(ctxUser(1), connect.NewRequest(&inventoryv1.StockPickRequest{
		TeamId: owner, WarehouseId: warehouse, Ref: "ORD-1",
		Lines: []*inventoryv1.StockPickLine{{ProductId: product, Quantity: 30}},
	}))
	if err != nil {
		t.Fatalf("StockPick: %v", err)
	}

	_, err = svc.StockReturn(ctxUser(1), connect.NewRequest(&inventoryv1.StockReturnRequest{
		TeamId: owner, WarehouseId: warehouse, Ref: "ORD-1",
	}))
	if err != nil {
		t.Fatalf("StockReturn: %v", err)
	}

	layers, _ := ownerLayers(t, svc, owner, product, warehouse)

	if len(layers) != 1 || layers[0].GetOnHand() != 100 {
		t.Fatalf("after a cancelled order the layer is %v, want a single layer back at 100", layers)
	}
}
