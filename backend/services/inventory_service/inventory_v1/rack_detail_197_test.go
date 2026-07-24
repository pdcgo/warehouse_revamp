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
		TeamId: 2, WarehouseId: rackWarehouse, ShippingCode: "jne",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: priced, Sku: "SKU1", Name: "Widget", Quantity: 10, TotalPrice: 500000},
		},
	}))
	if err != nil {
		t.Fatalf("create restock: %v", err)
	}

	request := created.Msg.GetRequest()

	lines := make([]*inventoryv1.RestockRequestReceivedLine, 0, len(request.GetItems()))
	for _, item := range request.GetItems() {
		lines = append(lines, &inventoryv1.RestockRequestReceivedLine{
			ItemId:           item.GetId(),
			ReceivedQuantity: item.GetQuantity(),
			Placements: []*inventoryv1.RestockPlacement{
				{Place: &inventoryv1.RestockPlacement_RackId{RackId: rackID}, Quantity: item.GetQuantity()},
			},
		})
	}

	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: rackWarehouse, RequestId: request.GetId(), Lines: lines,
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	// The second product with NO restock behind it. StockReceive lands goods in the unplaced pile —
	// a real place (#135) — so a StockMove is what puts them on this shelf, which is also the movement
	// the Placement History tab is about.
	_, err = svc.StockReceive(ctx, connect.NewRequest(&inventoryv1.StockReceiveRequest{
		WarehouseId: rackWarehouse, ProductId: unpriced, Quantity: 4,
	}))
	if err != nil {
		t.Fatalf("receive: %v", err)
	}

	_, err = svc.StockMove(ctx, connect.NewRequest(&inventoryv1.StockMoveRequest{
		WarehouseId: rackWarehouse, ProductId: unpriced, Quantity: 4,
		From: &inventoryv1.StockPlace{Place: &inventoryv1.StockPlace_Unplaced{Unplaced: true}},
		To:   &inventoryv1.StockPlace{Place: &inventoryv1.StockPlace_RackId{RackId: rackID}},
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
		t.Fatalf("total on hand = %d, want 14 (10 restocked + 4 received)", summary.GetTotalOnHand())
	}

	// 500.000 over 10 units = 50.000 each, and no freight on this request.
	if summary.GetTotalValue() != 500000 {
		t.Fatalf("total value = %d, want 500000", summary.GetTotalValue())
	}

	// ⚠ The product with no restock behind it contributes NOTHING and is COUNTED. A shelf of
	// never-restocked goods must read as "worth little, and here is why" rather than as a confident
	// small number.
	if summary.GetUnknownCostProducts() != 1 {
		t.Fatalf("unknown-cost products = %d, want 1", summary.GetUnknownCostProducts())
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
		TeamId: rackWarehouse, RackId: rackID, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackStock: %v", err)
	}

	byProduct := map[uint64]*inventoryv1.RackStockLine{}
	for _, line := range res.Msg.GetLines() {
		byProduct[line.GetProductId()] = line
	}

	got := byProduct[priced]
	if got == nil || !got.GetCostKnown() || got.GetUnitCost() != 50000 || got.GetValue() != 500000 {
		t.Fatalf("the restocked line = %+v, want cost 50000 × 10 = 500000", got)
	}

	// ⚠ Unknown, not free — and the flag says which, so a screen never has to infer it from a zero.
	other := byProduct[unpriced]
	if other == nil || other.GetCostKnown() || other.GetValue() != 0 {
		t.Fatalf("the never-restocked line = %+v, want cost_known=false and value 0", other)
	}
}

// A RACK-SCOPED HISTORY, which StockHistory cannot give: it demands a product_id, because it answers
// "what happened to this product". Standing at a shelf the question is the other way round.
func TestRackHistory_ReturnsWhatHappenedToThisShelf(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackID, _, _ := aRackWithGoods(t, svc, db)

	res, err := svc.RackHistory(ctxUser(1), connect.NewRequest(&inventoryv1.RackHistoryRequest{
		TeamId: rackWarehouse, RackId: rackID, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackHistory: %v", err)
	}

	// Two receives landed on this shelf: the restock and the direct one.
	if len(res.Msg.GetMovements()) != 2 {
		t.Fatalf("%d movements, want 2", len(res.Msg.GetMovements()))
	}

	for _, m := range res.Msg.GetMovements() {
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
		TeamId: rackWarehouse, RackId: rackID, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackHistory: %v", err)
	}

	if len(all.Msg.GetMovements()) != 3 {
		t.Fatalf("%d movements unfiltered, want 3", len(all.Msg.GetMovements()))
	}

	placements, err := svc.RackHistory(ctxUser(1), connect.NewRequest(&inventoryv1.RackHistoryRequest{
		TeamId: rackWarehouse, RackId: rackID, Page: page1(),
		Kinds: []inventoryv1.MovementKind{
			inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE,
			inventoryv1.MovementKind_MOVEMENT_KIND_MOVE,
		},
	}))
	if err != nil {
		t.Fatalf("RackHistory(placements): %v", err)
	}

	if len(placements.Msg.GetMovements()) != 2 {
		t.Fatalf("%d placement movements, want the 2 receives", len(placements.Msg.GetMovements()))
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
		TeamId: 9, RackId: rackID, Page: page1(),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}
