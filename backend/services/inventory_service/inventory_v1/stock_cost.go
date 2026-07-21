package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// StockCost reports what products cost this warehouse, so an order can freeze its COGS (#74).
//
// THE COST IS THE LATEST FULFILLED RESTOCK'S PRICE for that product into this warehouse. That is a
// deliberate simplification, recorded in plans/revenue_service/brainstorming.md rather than hidden:
// a product can arrive on several restocks at different prices, so "what it cost" is genuinely
// ambiguous, and the honest alternatives — a weighted average, or FIFO cost layers — both need a model
// nothing here has yet. Latest-price needs nothing new and is right whenever prices are stable.
//
// It is safe to change later precisely because the caller FREEZES the answer onto the order line: a
// different rule changes what future orders record, and never rewrites what past ones already froze.
//
// Only FULFILLED restocks count. A pending request is a price somebody hoped for, not one that was
// paid — costing goods against it would book a margin on a delivery that has not happened.
//
// A product with no restock history is ABSENT from the response rather than reported as 0. "We do not
// know what this cost" and "this cost nothing" are different facts, and a zero row would let a caller
// compute a margin as if the goods were free.
func (s *Service) StockCost(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockCostRequest],
) (*connect.Response[inventoryv1.StockCostResponse], error) {
	type row struct {
		ProductID uint64
		UnitCost  int64
	}

	var rows []row

	// DISTINCT ON gives one row per product — the first in each group by the ORDER BY, which is the
	// most recently fulfilled request. Postgres-specific and worth it: the portable alternative is a
	// correlated subquery per product or a window-function wrapper, both noisier for the same answer.
	//
	// Ordered by the REQUEST's id, not the item's: a request is fulfilled as a unit, so its id is what
	// says "this delivery came after that one". Item ids only say what order the lines were typed in.
	err := s.db.
		WithContext(ctx).
		Raw(`
			SELECT DISTINCT ON (i.product_id)
			       i.product_id AS product_id,
			       -- DERIVED, and openly a rounding (#140). The line stores what the WHOLE line cost,
			       -- because that is the number a person reads off an invoice; the per-unit figure an
			       -- order needs is computed here and nowhere written back. 10.000 over 3 pieces is
			       -- 3.333 a piece, and the rupiah the division drops stays dropped rather than
			       -- corrupting the stored total.
			       --
			       -- quantity has CHECK > 0, so this cannot divide by zero.
			       (i.total_price / i.quantity) AS unit_cost
			FROM restock_request_items i
			JOIN restock_requests r ON r.id = i.restock_request_id
			WHERE r.warehouse_id = ?
			  AND r.status = ?
			  AND i.product_id IN ?
			ORDER BY i.product_id, r.id DESC`,
			req.Msg.GetWarehouseId(), restockStatusFulfilled, req.Msg.GetProductIds(),
		).
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	out := make([]*inventoryv1.StockCostLine, 0, len(rows))
	for i := range rows {
		out = append(out, &inventoryv1.StockCostLine{
			ProductId: rows[i].ProductID,
			UnitCost:  rows[i].UnitCost,
		})
	}

	return connect.NewResponse(&inventoryv1.StockCostResponse{Costs: out}), nil
}
