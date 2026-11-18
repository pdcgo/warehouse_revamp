package inventory_v1

import (
	"context"
	"log/slog"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// ReturnOrders answers which ORDER each `return` transaction put back on the shelf — selling_service's to say: the order
// naming it as its return (`orders.return_transaction_id`, written by the return accept). Inventory knows a return batch's
// transaction and nothing of orders, so a batch a return minted asks here for its *Retur · order #<id>*
// (a-returns-batch-opens-its-order). A transaction no order names is absent from the map. Answered in-process by the
// composition root (return_orders.go there), one call for a whole page.
type ReturnOrders interface {
	OrderIDsByReturnTransactions(ctx context.Context, transactionIDs []uint64) (map[uint64]uint64, error)
}

// noReturnOrders names no order — a test reading batches has no selling_service; the composition root always wires the
// real one. A return's batch then reads *Retur* with no order, as one whose order's move has not landed does.
type noReturnOrders struct{}

func (noReturnOrders) OrderIDsByReturnTransactions(context.Context, []uint64) (map[uint64]uint64, error) {
	return map[uint64]uint64{}, nil
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

	orders, err := s.returnOrders.OrderIDsByReturnTransactions(ctx, transactionIDs)
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
