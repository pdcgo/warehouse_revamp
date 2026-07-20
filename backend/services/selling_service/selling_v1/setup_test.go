package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
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
	picked    []string // refs picked, in order
	returned  []string // refs returned, in order
	pickErr   error    // if set, Pick refuses
	returnErr error    // if set, Return refuses
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

func (f *fakePicker) Return(_ context.Context, _, _ uint64, ref string) error {
	if f.returnErr != nil {
		return f.returnErr
	}

	f.returned = append(f.returned, ref)

	return nil
}

func newService(t *testing.T, db *gorm.DB) *selling_v1.Service {
	t.Helper()

	return selling_v1.NewService(db, &fakePicker{})
}

// newServiceWithPicker is for the tests that care what the picker did, or need it to refuse.
func newServiceWithPicker(t *testing.T, db *gorm.DB, picker selling_v1.StockPicker) *selling_v1.Service {
	t.Helper()

	return selling_v1.NewService(db, picker)
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

	resp, err := svc.OrderCreate(context.Background(), connect.NewRequest(&sellingv1.OrderCreateRequest{
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
