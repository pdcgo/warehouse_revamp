package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A RESTOCK CARRIES ONLY THE TEAM'S OWN PRODUCTS (a-restock-carries-only-the-teams-own-products), so every unit in
// stock has exactly one owner and a rack holds one row per product.

const (
	ownerMelati    uint64 = 2
	ownerSinar     uint64 = 3
	ownerWarehouse uint64 = 5
	melatisProduct uint64 = 601
	sinarsProduct  uint64 = 602
)

// fakeOwners is product id → its owning team; an id absent exists nowhere.
type fakeOwners map[uint64]uint64

func (f fakeOwners) Facts(_ context.Context, _ uint64, ids []uint64) (map[uint64]inventory_v1.ProductFact, error) {
	out := make(map[uint64]inventory_v1.ProductFact, len(ids))

	for _, id := range ids {
		if team, ok := f[id]; ok {
			out[id] = inventory_v1.ProductFact{TeamID: team}
		}
	}

	return out, nil
}

func ownerService(t *testing.T) *inventory_v1.Service {
	t.Helper()

	return inventory_v1.NewService(san_testdb.DB(t), nil, nil, nil, nil,
		fakeOwners{melatisProduct: ownerMelati, sinarsProduct: ownerSinar})
}

func createFor(svc *inventory_v1.Service, team, product uint64) error {
	_, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: team, WarehouseId: ownerWarehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: product, Sku: "SKU", Name: "Kaos", Count: 1, Total: 1000},
		},
	}))

	return err
}

func TestRestockCreate_TheTeamsOwnProductIsAccepted(t *testing.T) {
	err := createFor(ownerService(t), ownerMelati, melatisProduct)
	if err != nil {
		t.Fatalf("Melati restocking its own product: %v", err)
	}
}

func TestRestockCreate_AnotherTeamsProductIsRefused(t *testing.T) {
	err := createFor(ownerService(t), ownerMelati, sinarsProduct)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("Melati restocking Sinar's product: err = %v, want InvalidArgument", err)
	}
}

func TestRestockCreate_AProductThatExistsNowhereIsRefused(t *testing.T) {
	err := createFor(ownerService(t), ownerMelati, 999)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a product nobody owns: err = %v, want InvalidArgument", err)
	}
}

// An edit adding another team's product is refused the same way.
func TestRestockUpdate_AddingAnotherTeamsProductIsRefused(t *testing.T) {
	svc := ownerService(t)

	created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: ownerMelati, WarehouseId: ownerWarehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: melatisProduct, Sku: "SKU", Name: "Kaos", Count: 1, Total: 1000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	r := created.Msg.GetRequest()

	_, err = svc.RestockRequestUpdate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
		TeamId: ownerMelati, RequestId: r.GetId(),
		Items: append(r.GetItems(), &inventoryv1.RestockRequestItem{
			ProductId: sinarsProduct, Sku: "SKU", Name: "Kaos", Count: 1, Total: 1000,
		}),
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("an edit adding Sinar's product: err = %v, want InvalidArgument", err)
	}
}
