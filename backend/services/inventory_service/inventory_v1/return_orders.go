package inventory_v1

import (
	"context"
	"log/slog"

	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// SellingOrders is what inventory asks selling_service about ORDERS — selling's to say, answered in-process by the
// composition root (return_orders.go there) over selling's plain functions. Inventory knows a take's and a return's
// transactions and nothing of orders.
//
//   - OrderIDsByReturnTransactions: which ORDER each `return` transaction put back on the shelf — the order naming it as
//     its return (`orders.return_transaction_id`, written by the return accept), so a batch a return minted reads
//     *Retur · order #<id>* (a-returns-batch-opens-its-order). A transaction no order names is absent from the map. One
//     call for a whole page.
//   - FoundOrder: the order a found report names (a-found-lost-parcel-is-a-found-stock-in) — whose it is, where it
//     shipped from, its status and its take; ok = false when no order has that id. Asked before the report's
//     transaction: never under a lock.
//   - NoteFound: the note on the lost order's timeline naming the found request — written IN the report's database
//     transaction, so the request and the note land together or not at all. The order's status never moves (lost-is-final).
type SellingOrders interface {
	OrderIDsByReturnTransactions(ctx context.Context, transactionIDs []uint64) (map[uint64]uint64, error)
	FoundOrder(ctx context.Context, orderID uint64) (FoundOrder, bool, error)
	NoteFound(ctx context.Context, tx *gorm.DB, note FoundNote) error
}

// FoundOrder is an order as a found report naming it needs it: only ids and the status — nothing of the selling team's
// money (a warehouse sees no seller money).
type FoundOrder struct {
	ID          uint64
	TeamID      uint64
	WarehouseID uint64
	// The order's status as selling stores it ("lost", "shipped", …).
	Status string
	// Whether it is `lost`.
	Lost bool
	// The inventory transaction its take wrote; 0 = none recorded.
	TakeTransactionID uint64
}

// FoundNote is the lost order's timeline note naming a found request: who reported what, where.
type FoundNote struct {
	OrderID        uint64
	FoundRequestID uint64
	Count          int64
	ProductCode    string
	ProductName    string
	RackCode       string
	ActorID        uint64
	IsOverride     bool
}

// noSellingOrders names no order — a test reading batches has no selling_service; the composition root always wires the
// real one. A return's batch then reads *Retur* with no order, as one whose order's move has not landed does, and a
// found naming an order finds none.
type noSellingOrders struct{}

func (noSellingOrders) OrderIDsByReturnTransactions(context.Context, []uint64) (map[uint64]uint64, error) {
	return map[uint64]uint64{}, nil
}

func (noSellingOrders) FoundOrder(context.Context, uint64) (FoundOrder, bool, error) {
	return FoundOrder{}, false, nil
}

func (noSellingOrders) NoteFound(context.Context, *gorm.DB, FoundNote) error {
	return nil
}

// withReturnOrders names, on each batch of the page a RETURN minted, the order whose return it is
// (a-returns-batch-opens-its-order) — ONE call for the page, whatever its size, and none when the page holds no return's
// batch. `rows` and `batches` are the same page, row for row.
//
// A label, never the read: when the order side cannot answer, the batches read as they did before it existed — *Retur*,
// no link — and the log says so, as the order detail's return labels do.
func (s *Service) withReturnOrders(ctx context.Context, rows []batchRow, batches []*inventoryv1.StockBatch) {
	transactionIDs := make([]uint64, 0, len(rows))
	seen := make(map[uint64]struct{}, len(rows))

	for i := range rows {
		if inventory_service_models.TxType(rows[i].TxType) != inventory_service_models.TxReturn {
			continue
		}

		if _, dup := seen[rows[i].TransactionID]; dup {
			continue
		}

		seen[rows[i].TransactionID] = struct{}{}
		transactionIDs = append(transactionIDs, rows[i].TransactionID)
	}

	if len(transactionIDs) == 0 {
		return
	}

	orders, err := s.orders.OrderIDsByReturnTransactions(ctx, transactionIDs)
	if err != nil {
		slog.WarnContext(ctx, "a return's batch cannot name its order — read without it",
			slog.Int("transactions", len(transactionIDs)),
			slog.String("error", err.Error()),
		)

		return
	}

	for i := range rows {
		if inventory_service_models.TxType(rows[i].TxType) != inventory_service_models.TxReturn {
			continue
		}

		batches[i].ReturnOrderId = orders[rows[i].TransactionID]
	}
}
