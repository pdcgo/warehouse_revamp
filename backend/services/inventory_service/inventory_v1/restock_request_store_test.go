package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A LINE'S STORE (a-line-may-name-a-supplier-without-a-channel): optional, but when a line names one it names the
// store's supplier too, the store is that supplier's, and a store newly named is live. One kept from before stays even
// if it was deleted since — exactly as a supplier does.

const (
	stMelatiShopee uint64 = 312 // Melati's open store
	stMelatiOld    uint64 = 313 // Melati's store, deleted
	stSinarShop    uint64 = 321 // Sinar's store
)

func stService(t *testing.T, stores map[uint64]inventory_v1.SupplierStore) *inventory_v1.Service {
	t.Helper()

	return newServiceWithStores(t, san_testdb.DB(t), fakeSuppliers{arrMelati: true, arrSinar: true}, stores)
}

func stStores() map[uint64]inventory_v1.SupplierStore {
	return map[uint64]inventory_v1.SupplierStore{
		stMelatiShopee: {SupplierID: arrMelati, Live: true},
		stMelatiOld:    {SupplierID: arrMelati, Live: false},
		stSinarShop:    {SupplierID: arrSinar, Live: true},
	}
}

func stCreate(svc *inventory_v1.Service, supplier, store uint64) (*inventoryv1.RestockRequest, error) {
	resp, err := svc.RestockRequestCreate(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: arrSellingTeam, WarehouseId: arrWarehouse, FinanceAccountId: arrAccount,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU-KAOS", Name: "Kaos", Count: 10, Total: 100000, SupplierId: supplier, SupplierChannelId: store},
		},
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg.GetRequest(), nil
}

// The supplier's own live store is kept on the line and read back.
func TestRestockRequestCreate_KeepsTheLinesStore(t *testing.T) {
	svc := stService(t, stStores())

	got, err := stCreate(svc, arrMelati, stMelatiShopee)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	line := got.GetItems()[0]
	if line.GetSupplierId() != arrMelati || line.GetSupplierChannelId() != stMelatiShopee {
		t.Fatalf("the line reads supplier %d store %d, want Melati and her store", line.GetSupplierId(), line.GetSupplierChannelId())
	}
}

// Each way a store can be wrong, and the code each one gets.
func TestRestockRequestCreate_RefusesAWrongStore(t *testing.T) {
	svc := stService(t, stStores())

	for name, c := range map[string]struct {
		supplier, store uint64
		want            connect.Code
	}{
		"a store with no supplier":           {0, stMelatiShopee, connect.CodeInvalidArgument},
		"another supplier's store":           {arrMelati, stSinarShop, connect.CodeInvalidArgument},
		"a store that exists nowhere":        {arrMelati, 999, connect.CodeNotFound},
		"a store deleted before it is named": {arrMelati, stMelatiOld, connect.CodeNotFound},
	} {
		_, err := stCreate(svc, c.supplier, c.store)
		if connect.CodeOf(err) != c.want {
			t.Fatalf("%s: got %v, want %v", name, err, c.want)
		}
	}
}

// A STORE KEPT IS NOT RE-ASKED. A restock that named Melati's store before it was deleted can still be edited; naming a
// deleted store anew is refused.
func TestRestockRequestUpdate_KeepsAStoreDeletedSince(t *testing.T) {
	stores := stStores()
	svc := stService(t, stores)

	raised, err := stCreate(svc, arrMelati, stMelatiShopee)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Melati closes that store after the restock named it.
	stores[stMelatiShopee] = inventory_v1.SupplierStore{SupplierID: arrMelati, Live: false}

	edit := func(store uint64) error {
		_, updErr := svc.RestockRequestUpdate(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
			TeamId: arrSellingTeam, RequestId: raised.GetId(), WarehouseId: arrWarehouse, FinanceAccountId: arrAccount,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU-KAOS", Name: "Kaos", Count: 12, Total: 120000, SupplierId: arrMelati, SupplierChannelId: store},
			},
		}))

		return updErr
	}

	err = edit(stMelatiShopee)
	if err != nil {
		t.Fatalf("editing a line whose store was deleted since must still work, got %v", err)
	}

	err = edit(stMelatiOld)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("re-pointing the line at a deleted store = %v, want NotFound", err)
	}
}
