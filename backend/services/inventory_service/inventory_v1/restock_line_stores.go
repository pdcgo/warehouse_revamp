package inventory_v1

import (
	"context"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// storeAnswer is supplier_service's answer about the stores a restock's lines name, taken BEFORE any lock — a call to
// another service must never run while a restock is held FOR UPDATE
// (audits/services/inventory_service/concurrency/RestockRequestUpdate.md).
type storeAnswer struct {
	stores map[uint64]SupplierStore
	err    error
}

// askLineStores asks once, for every store the lines name. A restock naming no store asks nothing.
func (s *Service) askLineStores(
	ctx context.Context,
	teamID uint64,
	items []*inventoryv1.RestockRequestItem,
) storeAnswer {
	seen := make(map[uint64]struct{}, len(items))
	ids := make([]uint64, 0, len(items))

	for _, item := range items {
		id := item.GetSupplierChannelId()
		if id == 0 {
			continue
		}

		if _, done := seen[id]; done {
			continue
		}

		seen[id] = struct{}{}
		ids = append(ids, id)
	}

	if len(ids) == 0 {
		return storeAnswer{}
	}

	stores, err := s.suppliers.Stores(ctx, teamID, ids)

	return storeAnswer{stores: stores, err: err}
}

// check is one line's store against the answer (a-line-may-name-a-supplier-without-a-channel): a store names its
// supplier, belongs to it, and is live. A line naming no store passes.
func (a storeAnswer) check(item *inventoryv1.RestockRequestItem) error {
	id := item.GetSupplierChannelId()
	if id == 0 {
		return nil
	}

	if item.GetSupplierId() == 0 {
		return errRestockStoreWithoutSupplier
	}

	if a.err != nil {
		return a.err
	}

	store, ok := a.stores[id]
	if !ok || !store.Live {
		return errRestockStoreMissing
	}

	if store.SupplierID != item.GetSupplierId() {
		return errRestockStoreNotTheSuppliers
	}

	return nil
}
