package selling_v1_test

import (
	"context"
	"strconv"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// fakePicker stands in for inventory_service in these tests (#149/#70).
//
// A fake rather than the real thing on purpose: it makes the FAILURE paths reachable. "Not enough
// stock means no order" and "a failed order write puts the stock back" both need the picker to refuse
// on demand, which a real warehouse would only do after elaborate seeding — and it records what it was
// asked to do, so a test can assert that a compensation actually happened rather than inferring it.
//
// What the take DREW is told three ways, from the simplest: `costs` is a product's unit cost, drawn as quantity × it
// with the total equal to the cost (an own product); `totals` overrides a line's total (a borrowed product's markup);
// `draw` is the answer verbatim, for a draw no single unit price describes — two batches at two costs. A product absent
// from all three is one the take named no draw for (an-order-is-costed-at-what-leaves-the-shelf).
type fakePicker struct {
	picked    []string                // refs picked, in order
	asked     [][]selling_v1.PickLine // the lines each pick was asked for, in order
	returned  []string                // refs returned, in order
	pickErr   error                   // if set, Pick refuses
	costs     map[uint64]int64        // each product's unit cost as the take draws it
	totals    map[uint64]float64      // a line's total, when it is not its cost
	draw      selling_v1.PickDraw     // a product's draw, verbatim
	returnErr error                   // if set, Return refuses
}

func (f *fakePicker) Pick(
	_ context.Context,
	_, _ uint64,
	lines []selling_v1.PickLine,
	ref string,
) (selling_v1.PickDraw, error) {
	if f.pickErr != nil {
		return nil, f.pickErr
	}

	f.picked = append(f.picked, ref)
	f.asked = append(f.asked, lines)

	draw := selling_v1.PickDraw{}

	for _, line := range lines {
		if verbatim, ok := f.draw[line.ProductID]; ok {
			draw[line.ProductID] = verbatim

			continue
		}

		unit, costed := f.costs[line.ProductID]
		total, priced := f.totals[line.ProductID]

		if !costed && !priced {
			continue
		}

		cost := float64(unit) * float64(line.Quantity)
		if !priced {
			total = cost
		}

		// As the take answers it: the markup is what the total adds to the cost, and one unit at the markup is the
		// total over the quantity — on an own product, 0 and the unit cost.
		draw[line.ProductID] = selling_v1.PickedLine{
			Cost:               cost,
			UnitCost:           float64(unit),
			Total:              total,
			UnitCostWithMarkup: total / float64(line.Quantity),
			MarkupTotal:        total - cost,
		}
	}

	return draw, nil
}

func (f *fakePicker) Return(_ context.Context, _, _ uint64, ref string) error {
	if f.returnErr != nil {
		return f.returnErr
	}

	f.returned = append(f.returned, ref)

	return nil
}

// fakeCatalog stands in for product_service when a draft is promoted (#194).
//
// It resolves EVERY id to a synthetic snapshot except those named in `missing` — which is the shape
// the real thing has, where an id that resolves to nothing means the product was deleted underneath
// the draft. Making absence the explicit opt-in keeps the stale-reference test honest: it has to say
// which product died, rather than passing because the fake happened to know nothing.
//
// A product's OWNER is 0 — "resolved to nobody" — unless `owners` names one, so every test that does not care whose
// goods it sells places an order no rule treats as borrowed. A test about another team's product says which team owns
// it, and `err` makes the lookup fail (a-failed-owner-lookup-refuses-the-create).
type fakeCatalog struct {
	missing map[uint64]bool
	owners  map[uint64]uint64
	err     error
}

func (c *fakeCatalog) Snapshots(
	_ context.Context,
	_ uint64,
	productIDs []uint64,
) (map[uint64]selling_v1.ProductSnapshot, error) {
	if c.err != nil {
		return nil, c.err
	}

	out := map[uint64]selling_v1.ProductSnapshot{}

	for _, id := range productIDs {
		if c.missing[id] {
			continue
		}

		sku := "SKU" + strconv.FormatUint(id, 10)
		out[id] = selling_v1.ProductSnapshot{SKU: sku, Name: "Catalogue " + sku, TeamID: c.owners[id]}
	}

	return out, nil
}

func newService(t *testing.T, db *gorm.DB) *selling_v1.Service {
	t.Helper()

	// nil sender — NewService substitutes EmptySender, which still validates the event (#153).
	return selling_v1.NewService(db, &fakePicker{}, nil, &fakeCatalog{}, &fakeCredit{}, nil, nil, nil)
}

// newServiceWithEvents is for the tests that care WHICH EVENT was published (#153).
func newServiceWithEvents(t *testing.T, db *gorm.DB, events event_source.EventSender) *selling_v1.Service {
	t.Helper()

	return selling_v1.NewService(db, &fakePicker{}, events, &fakeCatalog{}, &fakeCredit{}, nil, nil, nil)
}

// newServiceWithPicker is for the tests that care what the picker did, or need it to refuse.
func newServiceWithPicker(t *testing.T, db *gorm.DB, picker selling_v1.StockPicker) *selling_v1.Service {
	t.Helper()

	return selling_v1.NewService(db, picker, nil, &fakeCatalog{}, &fakeCredit{}, nil, nil, nil)
}

// newServiceWithCatalog is for the tests where a product died underneath a draft (#194).
func newServiceWithCatalog(
	t *testing.T,
	db *gorm.DB,
	catalog selling_v1.ProductCatalog,
) *selling_v1.Service {
	t.Helper()

	return selling_v1.NewService(db, &fakePicker{}, nil, catalog, &fakeCredit{}, nil, nil, nil)
}

// insertShop seeds an active shop directly and returns its id.
func insertShop(t *testing.T, db *gorm.DB, teamID uint64, name, code, marketplace string) uint64 {
	t.Helper()

	s := selling_service_models.Shop{TeamID: teamID, Name: name, ShopCode: code, Marketplace: marketplace}

	err := db.Create(&s).Error
	if err != nil {
		t.Fatalf("insert shop: %v", err)
	}

	return s.ID
}

// placeOrder creates a PLACED order through the service (one line) and returns its id.
// testWarehouse is the warehouse every fixture order ships from (#72). Orders name a warehouse now,
// and these say so out loud rather than leaning on a zero value — a test that quietly stored "no
// warehouse" would keep passing while describing an order the system could not actually fulfil.
const testWarehouse uint64 = 900

func placeOrder(t *testing.T, svc *selling_v1.Service, teamID, shopID uint64) uint64 {
	t.Helper()

	return placeOrderAs(t, svc, context.Background(), teamID, shopID)
}

// placeOrderAs is placeOrder with a caller — for the tests that care WHO did it (the history, 00011).
// An anonymous context is a legitimate case here rather than an oversight: the event records actor 0,
// "not recorded", exactly as every backfilled row does.
func placeOrderAs(
	t *testing.T,
	svc *selling_v1.Service,
	ctx context.Context,
	teamID, shopID uint64,
) uint64 {
	t.Helper()

	resp, err := svc.OrderCreate(ctx, connect.NewRequest(&sellingv1.OrderCreateRequest{
		PlatformCreatedAtUnix: testPlatformDate,
		PlatformTotal:         testPlatformTotal,
		TeamId:                teamID, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Budi",
		Items: []*sellingv1.OrderItem{
			{ProductId: 1, Sku: "SKU1", Name: "Widget", Quantity: 1},
		},
	}))
	if err != nil {
		t.Fatalf("place order: %v", err)
	}

	return resp.Msg.GetOrder().GetId()
}

// fakeCredit is the liability side of an order, in the only two states the order flow cares about:
// everybody allows it, or one named creditor does not.
//
// It records what it was ASKED, because half of #189 is that the right creditors get checked at all —
// a check that silently only ever looks at the warehouse would pass every "is it blocked" test while
// letting a frozen product owner's goods ship forever.
type fakeCredit struct {
	block *selling_v1.CreditBlock
	err   error
	asked []uint64
}

func (f *fakeCredit) Check(
	_ context.Context,
	_ uint64,
	creditorTeamIDs []uint64,
) (*selling_v1.CreditBlock, error) {
	f.asked = creditorTeamIDs

	return f.block, f.err
}

// fakeFees stands in for warehouse_service's WarehouseFeeCalculate (the-flat-rate-is-dropped-last step 3).
//
// It prices a flat percent of the goods cost, so a test can assert the fee was computed FROM the order's goods_cost rather
// than invented; `err` makes the refusal of a warehouse with no rate reachable; `asked` records the basis it was given.
type fakeFees struct {
	percent float64
	err     error
	asked   []float64
}

func (f *fakeFees) Price(_ context.Context, _, _ uint64, goodsCost float64) (float64, error) {
	f.asked = append(f.asked, goodsCost)

	if f.err != nil {
		return 0, f.err
	}

	return goodsCost * f.percent / 100, nil
}

// newServiceWithFees is for the tests about the frozen fee: a picker that knows costs, and a pricer.
func newServiceWithFees(t *testing.T, db *gorm.DB, picker *fakePicker, fees selling_v1.WarehouseFeePricer) *selling_v1.Service {
	t.Helper()

	return selling_v1.NewService(db, picker, nil, &fakeCatalog{}, &fakeCredit{}, nil, nil, fees)
}

// newServiceWithCredit is for the tests that care whether an order is REFUSED (#189).
func newServiceWithCredit(t *testing.T, db *gorm.DB, credit selling_v1.CreditChecker) *selling_v1.Service {
	t.Helper()

	return selling_v1.NewService(db, &fakePicker{}, nil, &fakeCatalog{}, credit, nil, nil, nil)
}

// testPlatformDate is when the buyer of every test order ordered on the storefront — REQUIRED at placement
// (platform-created-at-is-required-at-finalize). A fixed moment, so a test asserting on it asserts on one value.
const testPlatformDate int64 = 1_790_000_000

// testPlatformTotal is what the buyer of every test order paid on the storefront — REQUIRED at placement too
// (platform-total-is-required-at-finalize). A test that asserts on the figure sets its own.
const testPlatformTotal int64 = 12_000
