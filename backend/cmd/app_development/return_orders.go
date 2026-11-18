package main

import (
	"context"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// inventoryReturnOrders answers inventory's ReturnOrders from selling_service, IN-PROCESS: which order each `return`
// transaction put back on the shelf, so a batch a return minted reads *Retur · order #<id>* and opens that order's
// warehouse page (a-returns-batch-opens-its-order). One call per page of batches.
//
// selling's PLAIN function over the shared database, as productHistory is — not *selling_v1.Service: selling already takes
// stock through inventory (stock_picker.go), so a Service dep here would close a cycle in the Wire graph. The batch read
// asking has run its own policy, scoped to the warehouse holding the batches; only order ids come back.
type inventoryReturnOrders struct {
	db *gorm.DB
}

func NewInventoryReturnOrders(db *gorm.DB) inventory_v1.ReturnOrders {
	return inventoryReturnOrders{db: db}
}

func (r inventoryReturnOrders) OrderIDsByReturnTransactions(
	ctx context.Context,
	transactionIDs []uint64,
) (map[uint64]uint64, error) {
	return selling_v1.OrderIDsByReturnTransactions(ctx, r.db, transactionIDs)
}
