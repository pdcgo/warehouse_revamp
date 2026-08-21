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
type fakePicker struct {
	picked    []string         // refs picked, in order
	returned  []string         // refs returned, in order
	pickErr   error            // if set, Pick refuses
	costs     map[uint64]int64 // what UnitCosts reports; a product ABSENT here has no known cost
	returnErr error            // if set, Return refuses
}

func (f *fakePicker) Pick(
	_ context.Context,
	_, _ uint64,
	_ []selling_v1.PickLine,
	ref string,
) error {
	if f.pickErr != nil {
		return f.pickErr
	}

	f.picked = append(f.picked, ref)

	return nil
}

func (f *fakePicker) UnitCosts(
	_ context.Context,
	_, _ uint64,
	_ []uint64,
) (map[uint64]int64, error) {
	return f.costs, nil
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
type fakeCatalog struct {
	missing map[uint64]bool
}

func (c *fakeCatalog) Snapshots(
	_ context.Context,
	_ uint64,
	productIDs []uint64,
) (map[uint64]selling_v1.ProductSnapshot, error) {
	out := map[uint64]selling_v1.ProductSnapshot{}

	for _, id := range productIDs {
		if c.missing[id] {
			continue
		}

		sku := "SKU" + strconv.FormatUint(id, 10)
		out[id] = selling_v1.ProductSnapshot{SKU: sku, Name: "Catalogue " + sku}
	}

	return out, nil
}

func newService(t *testing.T, db *gorm.DB) *selling_v1.Service {
	t.Helper()

	// nil sender — NewService substitutes EmptySender, which still validates the event (#153).
	return selling_v1.NewService(db, &fakePicker{}, nil, &fakeCatalog{}, &fakeCredit{})
}

// newServiceWithEvents is for the tests that care WHICH EVENT was published (#153).
func newServiceWithEvents(t *testing.T, db *gorm.DB, events event_source.EventSender) *selling_v1.Service {
	t.Helper()

	return selling_v1.NewService(db, &fakePicker{}, events, &fakeCatalog{}, &fakeCredit{})
}

// newServiceWithPicker is for the tests that care what the picker did, or need it to refuse.
func newServiceWithPicker(t *testing.T, db *gorm.DB, picker selling_v1.StockPicker) *selling_v1.Service {
	t.Helper()

	return selling_v1.NewService(db, picker, nil, &fakeCatalog{}, &fakeCredit{})
}

// newServiceWithCatalog is for the tests where a product died underneath a draft (#194).
func newServiceWithCatalog(
	t *testing.T,
	db *gorm.DB,
	catalog selling_v1.ProductCatalog,
) *selling_v1.Service {
	t.Helper()

	return selling_v1.NewService(db, &fakePicker{}, nil, catalog, &fakeCredit{})
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
		TeamId: teamID, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Budi", Subtotal: 10000, Total: 10000,
		Items: []*sellingv1.OrderItem{
			{ProductId: 1, Sku: "SKU1", Name: "Widget", Quantity: 1, UnitPrice: 10000},
		},
	}))
	if err != nil {
		t.Fatalf("place order: %v", err)
	}

	return resp.Msg.GetOrder().GetId()
}

// fakeCredit is the settlement side of an order, in the only two states the order flow cares about:
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

// newServiceWithCredit is for the tests that care whether an order is REFUSED (#189).
func newServiceWithCredit(t *testing.T, db *gorm.DB, credit selling_v1.CreditChecker) *selling_v1.Service {
	t.Helper()

	return selling_v1.NewService(db, &fakePicker{}, nil, &fakeCatalog{}, credit)
}
