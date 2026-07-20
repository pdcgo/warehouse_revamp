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

func newService(t *testing.T, db *gorm.DB) *selling_v1.Service {
	t.Helper()

	return selling_v1.NewService(db)
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
