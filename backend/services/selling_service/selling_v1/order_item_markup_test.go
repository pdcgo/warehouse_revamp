package selling_v1_test

import (
	"context"
	"math"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// THE OWNER'S FOUR MONEY COLUMNS OF A LINE (§Table That Must Have, `order_items`), frozen from the take's one answer
// (inventory-computes-the-markup, a-lines-money-is-frozen-at-finalize): `unit_cost`, `unit_cost_with_markup`,
// `markup_total`, `total`. A borrowed line carries its owner's markup; an own line in the same order carries none.
func TestOrderCreate_ALineFreezesEveryFigureOfTheTake(t *testing.T) {
	db := san_testdb.DB(t)

	// Team 2 sells 2 of its own product at 9.000 and 3 of team 9's, drawn 2 × 10.000 + 1 × 14.000 = 34.000 and
	// priced by the take at team 9's 20% markup: 40.800 in all, 13.600 a unit, 6.800 of it markup.
	picker := &fakePicker{
		costs: map[uint64]int64{ourProduct: 9_000},
		draw: selling_v1.PickDraw{borrowedA: {
			Cost: 34_000, UnitCost: 34_000.0 / 3, Total: 40_800, UnitCostWithMarkup: 13_600, MarkupTotal: 6_800,
		}},
	}
	svc := selling_v1.NewService(db, picker, nil, returnMapCatalog(), &fakeCredit{}, nil, nil, nil)
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	mapForReturns(t, svc, mapTeam, borrowedA, ourProduct)

	req := borrowedOrderReq(shop)
	req.Items = []*sellingv1.OrderItem{
		{ProductId: ourProduct, Sku: "OWN", Name: "Our own", Quantity: 2},
		{ProductId: borrowedA, Sku: "THEIRS", Name: "Borrowed", Quantity: 3},
	}

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	stored := storedOrder(t, db, created.Msg.GetOrder().GetId())
	if len(stored.Items) != 2 {
		t.Fatalf("stored %d lines, want 2", len(stored.Items))
	}

	lines := map[uint64]selling_service_models.OrderItem{}
	for _, item := range stored.Items {
		lines[item.ProductID] = item
	}

	// THE BORROWED LINE — every figure the take answered.
	theirs := lines[borrowedA]
	if theirs.UnitCost != 11_333 ||
		!frozenAt(theirs.UnitCostWithMarkup, 13_600) || !frozenAt(theirs.MarkupTotal, 6_800) || !frozenAt(theirs.Total, 40_800) {
		t.Fatalf("borrowed line %+v — want unit cost 11333, with markup 13600, markup 6800, total 40800", theirs)
	}

	// markup_total = total − unit_cost × qty, within the rounding of the whole-rupiah unit cost (half a rupiah a unit).
	gap := math.Abs(*theirs.MarkupTotal - (*theirs.Total - float64(theirs.UnitCost)*float64(theirs.Quantity)))
	if gap > 0.5*float64(theirs.Quantity) {
		t.Fatalf("markup_total %v is %v away from total − unit_cost × qty", *theirs.MarkupTotal, gap)
	}

	// THE OWN LINE — no markup: the price with markup is the cost, the markup is 0, the total is the draw.
	ours := lines[ourProduct]
	if ours.UnitCost != 9_000 ||
		!frozenAt(ours.UnitCostWithMarkup, 9_000) || !frozenAt(ours.MarkupTotal, 0) || !frozenAt(ours.Total, 18_000) {
		t.Fatalf("own line %+v — want unit cost 9000, with markup 9000, markup 0, total 18000", ours)
	}

	// …and the API carries them out as stored.
	detail, err := svc.OrderDetail(asUser(7), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: mapTeam, OrderId: created.Msg.GetOrder().GetId(),
	}))
	if err != nil {
		t.Fatalf("OrderDetail: %v", err)
	}

	for _, item := range detail.Msg.GetOrder().GetItems() {
		want := lines[item.GetProductId()]
		if item.Total == nil || item.GetTotal() != *want.Total ||
			item.UnitCostWithMarkup == nil || item.GetUnitCostWithMarkup() != *want.UnitCostWithMarkup ||
			item.MarkupTotal == nil || item.GetMarkupTotal() != *want.MarkupTotal {
			t.Fatalf("OrderDetail line %v — want the stored %+v", item, want)
		}
	}
}

// A BORROWED LINE RAISES goods_cost BY ITS MARKUP, AND THE FEE FOLLOWS (the-cross-charge-lives-on-the-line,
// the-fee-is-priced-on-goods-cost): the goods cost the seller what each line's total says — an own line its drawn cost, a
// borrowed line the owner's cost plus the owner's markup. Here 18.000 own + 40.800 borrowed = 58.800, never the 52.000
// drawn; the warehouse prices its 10% on that, and total_cost adds the two.
func TestOrderCreate_ABorrowedLineRaisesTheGoodsCostByItsMarkupAndTheFeeFollows(t *testing.T) {
	db := san_testdb.DB(t)

	picker := &fakePicker{
		costs: map[uint64]int64{ourProduct: 9_000},
		draw: selling_v1.PickDraw{borrowedA: {
			Cost: 34_000, UnitCost: 34_000.0 / 3, Total: 40_800, UnitCostWithMarkup: 13_600, MarkupTotal: 6_800,
		}},
	}
	fees := &fakeFees{percent: 10}
	svc := selling_v1.NewService(db, picker, nil, returnMapCatalog(), &fakeCredit{}, nil, nil, fees)
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	mapForReturns(t, svc, mapTeam, borrowedA, ourProduct)

	req := borrowedOrderReq(shop)
	req.Items = []*sellingv1.OrderItem{
		{ProductId: ourProduct, Sku: "OWN", Name: "Our own", Quantity: 2},
		{ProductId: borrowedA, Sku: "THEIRS", Name: "Borrowed", Quantity: 3},
	}

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	order := created.Msg.GetOrder()

	if order.GetGoodsCost() != 58_800 {
		t.Fatalf("goods_cost %d — want 58800: the own 18000 plus the borrowed line's 40800 WITH its markup", order.GetGoodsCost())
	}

	if len(fees.asked) != 1 || fees.asked[0] != 58_800 {
		t.Fatalf("the warehouse was asked to price %v — want once, on the goods_cost 58800", fees.asked)
	}

	if order.GetWarehouseFee() != 5_880 || order.GetTotalCost() != 64_680 {
		t.Fatalf("fee %v, total_cost %v — want 5880 and 58800 + 5880", order.GetWarehouseFee(), order.GetTotalCost())
	}

	stored := storedOrder(t, db, order.GetId())
	if stored.GoodsCost != 58_800 || stored.TotalCost != 64_680 {
		t.Fatalf("stored goods_cost %d, total_cost %v — want what the response said", stored.GoodsCost, stored.TotalCost)
	}
}

// A product the take named no draw for freezes NONE of the take's figures — absent, never a 0 that reads as free.
func TestOrderCreate_ALineTheTakeDidNotPriceFreezesNoMarkup(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithPicker(t, db, &fakePicker{})
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	stored := storedOrder(t, db, created.Msg.GetOrder().GetId())

	line := stored.Items[0]
	if line.UnitCost != 0 || line.Total != nil || line.UnitCostWithMarkup != nil || line.MarkupTotal != nil {
		t.Fatalf("stored line %+v — want no cost, and nothing of the take frozen", line)
	}

	detail, err := svc.OrderDetail(asUser(7), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: created.Msg.GetOrder().GetId(),
	}))
	if err != nil {
		t.Fatalf("OrderDetail: %v", err)
	}

	item := detail.Msg.GetOrder().GetItems()[0]
	if item.Total != nil || item.UnitCostWithMarkup != nil || item.MarkupTotal != nil {
		t.Fatalf("OrderDetail line %v — want the three figures absent", item)
	}
}

// AN ORDER LINE CARRIES NO MARKETPLACE PRICE (an-order-line-carries-no-marketplace-price). A draft's rows carry what
// the marketplace charged — 50.000 and 35.000 — and the promoted order's lines hold none of it: every money figure of
// a line is the take's, exactly what OrderCreate stores for the same draw, and so is the header's goods_cost.
func TestOrderCreateFromDraft_TheLineCarriesNoMarketplacePrice(t *testing.T) {
	db := san_testdb.DB(t)
	costs := map[uint64]int64{41: 20_000, 42: 12_500}

	promoteSvc := newServiceWithPicker(t, db, &fakePicker{costs: costs})
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	// Product 41 × 2 at the marketplace's 50.000, product 42 × 1 at its 35.000.
	draftID := readyDraft(t, promoteSvc, db, shop)

	promoted, err := promote(t, promoteSvc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("promote: %v", err)
	}

	// THE SAME LINES TYPED ON THE FORM, drawn the same way. A line carries no price, so neither door has one to send.
	createSvc := newServiceWithPicker(t, db, &fakePicker{costs: costs})

	req := orderReq(shop)
	req.Items = []*sellingv1.OrderItem{
		{ProductId: 41, Sku: "SKU41", Name: "Catalogue SKU41", Quantity: 2},
		{ProductId: 42, Sku: "SKU42", Name: "Catalogue SKU42", Quantity: 1},
	}

	created, err := createSvc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	fromDraft := storedOrder(t, db, promoted.GetId())
	typed := storedOrder(t, db, created.Msg.GetOrder().GetId())

	if len(fromDraft.Items) != 2 || len(typed.Items) != 2 {
		t.Fatalf("lines: promoted %d, created %d — want 2 each", len(fromDraft.Items), len(typed.Items))
	}

	for i, line := range fromDraft.Items {
		if line.UnitCost != costs[line.ProductID] {
			t.Fatalf("promoted line %+v — want the take's unit cost %d, never the marketplace's price", line, costs[line.ProductID])
		}

		other := typed.Items[i]
		if line.ProductID != other.ProductID || line.UnitCost != other.UnitCost ||
			*line.Total != *other.Total || *line.UnitCostWithMarkup != *other.UnitCostWithMarkup ||
			*line.MarkupTotal != *other.MarkupTotal {
			t.Fatalf("promoted line %+v — OrderCreate stored %+v for the same draw", line, other)
		}
	}

	// 2 × 20.000 + 1 × 12.500 on both doors — never the rows' 2 × 50.000 + 35.000.
	if fromDraft.GoodsCost != 52_500 || typed.GoodsCost != 52_500 {
		t.Fatalf("goods_cost: promoted %d, created %d — want the take's 52500 on both doors", fromDraft.GoodsCost, typed.GoodsCost)
	}
}

// frozenAt reports whether a frozen figure is present and equal to want.
func frozenAt(got *float64, want float64) bool {
	return got != nil && *got == want
}
