package main

import (
	"context"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// inventoryReturnOrders answers inventory's SellingOrders from selling_service, IN-PROCESS (named for its first
// question; the provider keeps its name in the Wire graph):
//
//   - which order each `return` transaction put back on the shelf, so a batch a return minted reads *Retur · order #<id>*
//     and opens that order's warehouse page (a-returns-batch-opens-its-order). One call per page of batches;
//   - the order a found report names, and the note on its timeline naming the request
//     (a-found-lost-parcel-is-a-found-stock-in) — the note in the report's own database transaction.
//
// selling's PLAIN functions over the shared database, as productHistory is — not *selling_v1.Service: selling already
// takes stock through inventory (stock_picker.go), so a Service dep here would close a cycle in the Wire graph. The
// inventory read or write asking has run its own policy, scoped to the warehouse; only ids and a status come back.
type inventoryReturnOrders struct {
	db *gorm.DB
}

func NewInventoryReturnOrders(db *gorm.DB) inventory_v1.SellingOrders {
	return inventoryReturnOrders{db: db}
}

func (r inventoryReturnOrders) OrderIDsByReturnTransactions(
	ctx context.Context,
	transactionIDs []uint64,
) (map[uint64]uint64, error) {
	return selling_v1.OrderIDsByReturnTransactions(ctx, r.db, transactionIDs)
}

func (r inventoryReturnOrders) FoundOrder(ctx context.Context, orderID uint64) (inventory_v1.FoundOrder, bool, error) {
	order, ok, err := selling_v1.FoundOrderOf(ctx, r.db, orderID)
	if err != nil || !ok {
		return inventory_v1.FoundOrder{}, ok, err
	}

	return inventory_v1.FoundOrder{
		ID:                order.ID,
		TeamID:            order.TeamID,
		WarehouseID:       order.WarehouseID,
		Status:            order.Status,
		Lost:              order.Lost(),
		TakeTransactionID: order.TakeTransactionID,
	}, true, nil
}

func (r inventoryReturnOrders) NoteFound(ctx context.Context, tx *gorm.DB, note inventory_v1.FoundNote) error {
	return selling_v1.RecordFoundNote(ctx, tx, selling_v1.FoundNote{
		OrderID:        note.OrderID,
		FoundRequestID: note.FoundRequestID,
		Count:          note.Count,
		ProductCode:    note.ProductCode,
		ProductName:    note.ProductName,
		RackCode:       note.RackCode,
		ActorID:        note.ActorID,
		IsOverride:     note.IsOverride,
	})
}
