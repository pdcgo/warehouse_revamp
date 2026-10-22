package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// The rack detail page's header and its two money-shaped tabs (#197).

const rackWarehouse uint64 = 5

// aRackWithGoods creates a rack, restocks two products onto it through a fulfilled request (so they
// have a real HPP), and returns the rack id and the two product ids.
func aRackWithGoods(t *testing.T, svc *inventory_v1.Service, db *gorm.DB) (uint64, uint64, uint64) {
	t.Helper()

	ctx := ctxUser(1)

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{
		TeamId: rackWarehouse, Code: "A-01-3", Name: "Receiving bay",
	}))
	if err != nil {
		t.Fatalf("create rack: %v", err)
	}

	rackID := rack.Msg.GetRack().GetId()

	const priced, unpriced uint64 = 100, 200

	// Only `priced` arrives on a restock, so only it has a recorded cost. `unpriced` is received
	// straight into stock — which is exactly the "cost unknown" case the tiles have to be honest
	// about.
	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: rackWarehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: priced, Sku: "SKU1", Name: "Widget", Count: 10, Total: 500000},
		},
	}))
	if err != nil {
		t.Fatalf("create restock: %v", err)
	}

	request := created.Msg.GetRequest()

	lines := make([]*inventoryv1.RestockRequestReceivedLine, 0, len(request.GetItems()))
	for _, item := range request.GetItems() {
		lines = append(lines, &inventoryv1.RestockRequestReceivedLine{
			ItemId:        item.GetId(),
			ReceivedCount: item.GetCount(),
			Placements: []*inventoryv1.RestockPlacement{
				{PlacementId: rackID, Quantity: item.GetCount()},
			},
		})
	}

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: rackWarehouse, RequestId: request.GetId(), Lines: lines,
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	// The second product arrives on ANOTHER rack, at Rp 1.000 a unit, and is moved onto this one — the movement the
	// Placement History tab is about.
	elsewhere := receive(t, svc, ctx, rackWarehouse, unpriced, 4)

	_, err = svc.RackMove(ctx, connect.NewRequest(&inventoryv1.RackMoveRequest{
		TeamId: rackWarehouse, FromRackId: elsewhere,
		Lines: []*inventoryv1.RackMoveLine{{ProductId: unpriced, Quantity: 4, ToRackId: rackID}},
	}))
	if err != nil {
		t.Fatalf("move: %v", err)
	}

	return rackID, priced, unpriced
}

// THE HEADER TILES. The count is every unit on the shelf; the value is what those units cost, with
// the unknowns counted rather than guessed at.
func TestRackDetail_SummarisesWhatIsOnTheShelf(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackID, _, _ := aRackWithGoods(t, svc, db)

	res, err := svc.RackDetail(ctxUser(1), connect.NewRequest(&inventoryv1.RackDetailRequest{
		TeamId: rackWarehouse, RackId: rackID,
	}))
	if err != nil {
		t.Fatalf("RackDetail: %v", err)
	}

	summary := res.Msg.GetSummary()

	if summary.GetTotalOnHand() != 14 {
		t.Fatalf("total on hand = %d, want 14 (10 restocked + 4 moved in)", summary.GetTotalOnHand())
	}

	// 10 × 50.000 + 4 × 1.000.
	if summary.GetTotalValue() != 504000 {
		t.Fatalf("total value = %d, want 504000", summary.GetTotalValue())
	}

	// Every unit on the ledgers carries a price, so nothing on the shelf is of unknown cost.
	if summary.GetUnknownCostProducts() != 0 {
		t.Fatalf("unknown-cost products = %d, want 0", summary.GetUnknownCostProducts())
	}
}

// "Never counted" is a real and common answer for a new shelf, and it must not render as a date.
func TestRackDetail_AnUncountedShelfSaysSoRatherThanShowingAnEpoch(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackID, _, _ := aRackWithGoods(t, svc, db)

	res, err := svc.RackDetail(ctxUser(1), connect.NewRequest(&inventoryv1.RackDetailRequest{
		TeamId: rackWarehouse, RackId: rackID,
	}))
	if err != nil {
		t.Fatalf("RackDetail: %v", err)
	}

	if res.Msg.GetSummary().GetLastCountedAt() != "" {
		t.Fatalf("last counted = %q on a shelf nobody has counted, want empty",
			res.Msg.GetSummary().GetLastCountedAt())
	}
}

// A STOCK-TAKE IS WHAT THE TILE MEANS (#139) — an ADJUST naming this rack. Derived from the ledger,
// so there is no stored column that could drift from the movements that actually happened.
func TestRackDetail_TheLastCountIsTheLastStockTake(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackID, priced, _ := aRackWithGoods(t, svc, db)

	_, err := svc.StockAdjust(ctxUser(1), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: rackWarehouse, ProductId: priced, OnHand: 9,
		Place:  &inventoryv1.StockAdjustRequest_RackId{RackId: rackID},
		Reason: "stock take",
	}))
	if err != nil {
		t.Fatalf("StockAdjust: %v", err)
	}

	res, err := svc.RackDetail(ctxUser(1), connect.NewRequest(&inventoryv1.RackDetailRequest{
		TeamId: rackWarehouse, RackId: rackID,
	}))
	if err != nil {
		t.Fatalf("RackDetail: %v", err)
	}

	if res.Msg.GetSummary().GetLastCountedAt() == "" {
		t.Fatal("the shelf was counted and the tile still says never")
	}
}

// THE PRICES TAB reads the same call the Products tab does — one query, two views, so the count and
// the money beside it can never come from two different reads of the shelf.
func TestRackStock_CarriesTheCostAndTheValue(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackID, priced, unpriced := aRackWithGoods(t, svc, db)

	res, err := svc.RackStock(ctxUser(1), connect.NewRequest(&inventoryv1.RackStockRequest{
		TeamId: rackWarehouse, Filter: &inventoryv1.RackStockFilter{RackId: rackID}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackStock: %v", err)
	}

	byProduct := map[uint64]*inventoryv1.RackStockLine{}
	for _, line := range rackStockRows(res.Msg) {
		byProduct[line.GetProductId()] = line
	}

	got := byProduct[priced]
	if got == nil || !got.GetCostKnown() || got.GetUnitCost() != 50000 || got.GetValue() != 500000 {
		t.Fatalf("the restocked line = %+v, want cost 50000 × 10 = 500000", got)
	}

	other := byProduct[unpriced]
	if other == nil || !other.GetCostKnown() || other.GetUnitCost() != 1000 || other.GetValue() != 4000 {
		t.Fatalf("the moved-in line = %+v, want cost 1000 × 4 = 4000", other)
	}
}

// A RACK-SCOPED HISTORY, which StockHistory cannot give: it demands a product_id, because it answers
// "what happened to this product". Standing at a shelf the question is the other way round.
func TestRackHistory_ReturnsWhatHappenedToThisShelf(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackID, _, _ := aRackWithGoods(t, svc, db)

	res, err := svc.RackHistory(ctxUser(1), connect.NewRequest(&inventoryv1.RackHistoryRequest{
		TeamId: rackWarehouse, Filter: &inventoryv1.RackHistoryFilter{RackId: rackID}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackHistory: %v", err)
	}

	// Two receives landed on this shelf: the restock and the direct one.
	if len(rackHistoryRows(res.Msg)) != 2 {
		t.Fatalf("%d movements, want 2", len(rackHistoryRows(res.Msg)))
	}

	for _, m := range rackHistoryRows(res.Msg) {
		if m.GetRackId() != rackID {
			t.Fatalf("a movement on rack %d leaked into rack %d's history", m.GetRackId(), rackID)
		}
	}
}

// THE TWO TABS ARE TWO QUESTIONS OF ONE LEDGER: everything that changed a count, and the put-aways
// that decided goods live here. The kind filter is what separates them, and it is server-side because
// the list is paginated.
func TestRackHistory_FiltersToThePlacementKinds(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackID, priced, _ := aRackWithGoods(t, svc, db)

	_, err := svc.StockAdjust(ctxUser(1), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: rackWarehouse, ProductId: priced, OnHand: 9,
		Place:  &inventoryv1.StockAdjustRequest_RackId{RackId: rackID},
		Reason: "stock take",
	}))
	if err != nil {
		t.Fatalf("StockAdjust: %v", err)
	}

	all, err := svc.RackHistory(ctxUser(1), connect.NewRequest(&inventoryv1.RackHistoryRequest{
		TeamId: rackWarehouse, Filter: &inventoryv1.RackHistoryFilter{RackId: rackID}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackHistory: %v", err)
	}

	if len(rackHistoryRows(all.Msg)) != 3 {
		t.Fatalf("%d movements unfiltered, want 3", len(rackHistoryRows(all.Msg)))
	}

	placements, err := svc.RackHistory(ctxUser(1), connect.NewRequest(&inventoryv1.RackHistoryRequest{
		TeamId: rackWarehouse,
		Filter: &inventoryv1.RackHistoryFilter{
			RackId: rackID,
			Kinds: []inventoryv1.MovementKind{
				inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE,
				inventoryv1.MovementKind_MOVEMENT_KIND_MOVE,
			},
		},
		Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackHistory(placements): %v", err)
	}

	if len(rackHistoryRows(placements.Msg)) != 2 {
		t.Fatalf("%d placement movements, want the receive and the move", len(rackHistoryRows(placements.Msg)))
	}

	// The count must follow the filter too, or the pager reports rows the tab will not show.
	if placements.Msg.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("total_items = %d with a kind filter, want 2",
			placements.Msg.GetPageInfo().GetTotalItems())
	}
}

// Another warehouse's rack reads as NotFound, never as an empty history — "not yours" and "nothing
// has happened here" must not look the same, or a probe could map rack ids by which come back empty.
func TestRackHistory_AnotherWarehousesRackIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackID, _, _ := aRackWithGoods(t, svc, db)

	_, err := svc.RackHistory(ctxUser(1), connect.NewRequest(&inventoryv1.RackHistoryRequest{
		TeamId: 9, Filter: &inventoryv1.RackHistoryFilter{RackId: rackID}, Page: page1(),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}
