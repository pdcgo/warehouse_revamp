package inventory_v1

import (
	"context"
	"math"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// StockCost reports what products cost this warehouse, so an order can freeze its COGS (#74).
//
// THE COST IS THE AVERAGE VALUE OF THE UNITS HELD, read from the batch ledger (see unitCosts).
//
// It is safe to change later precisely because the caller FREEZES the answer onto the order line: a
// different rule changes what future orders record, and never rewrites what past ones already froze.
//
// Only stock that arrived counts: a pending restock is a price somebody hoped for, not one that was paid, and it has
// no batch yet.
//
// A product with no batch here is ABSENT from the response rather than reported as 0. "We do not
// know what this cost" and "this cost nothing" are different facts, and a zero row would let a caller
// compute a margin as if the goods were free.
func (s *Service) StockCost(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockCostRequest],
) (*connect.Response[inventoryv1.StockCostResponse], error) {
	costs, err := s.unitCosts(ctx, req.Msg.GetFilter().GetWarehouseId(), req.Msg.GetFilter().GetIds())
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	out := make([]*inventoryv1.StockCostLine, 0, len(costs))
	for productID, unitCost := range costs {
		out = append(out, &inventoryv1.StockCostLine{
			ProductId: productID,
			UnitCost:  unitCost,
		})
	}

	return connect.NewResponse(&inventoryv1.StockCostResponse{
		Items: stockCostMap(out, req.Msg.GetDataRequest()),
	}), nil
}

// unitCosts is the unit value of each product's stock in this warehouse, read from the batch ledger — shared by
// StockCost and by the rack's valuation (#197), so a shelf's value and an order's COGS are never two formulas.
//
// It is the WEIGHTED AVERAGE of the units held: Σ stock_valuation ÷ Σ stock_count over the product's batches here. The
// batches already carry the decided landed price (unit-price-is-line-price-plus-costs-per-unit), freight included. A
// product with no units left reads its NEWEST batch's price — the last thing it cost here.
//
// ⚠ The order's take charges oldest batch first, so its real cost can differ from this average; the take answers its
// own costs, and this is the preview a form freezes before it.
//
// A product with NO batch here is ABSENT from the map, never present as 0 — "we do not know what this cost" and "this
// cost nothing" are different facts. Whole rupiah until these reads turn `double` (money-is-double-in-the-api-too).
func (s *Service) unitCosts(
	ctx context.Context,
	warehouseID uint64,
	productIDs []uint64,
) (map[uint64]int64, error) {
	costs := map[uint64]int64{}

	// An empty id list would make `IN ?` invalid SQL, and "the cost of nothing" is an empty map rather than an error.
	if len(productIDs) == 0 {
		return costs, nil
	}

	var rows []struct {
		ProductID uint64
		UnitCost  float64
	}

	err := s.db.
		WithContext(ctx).
		Raw(`
			SELECT b.product_id,
			       CASE WHEN SUM(b.stock_count) > 0
			            THEN SUM(b.stock_valuation) / SUM(b.stock_count)
			            ELSE (SELECT n.price_unit FROM batches n
			                  WHERE n.warehouse_id = b.warehouse_id AND n.product_id = b.product_id
			                  ORDER BY n.id DESC LIMIT 1)
			       END AS unit_cost
			FROM batches b
			WHERE b.warehouse_id = ? AND b.product_id IN ?
			GROUP BY b.warehouse_id, b.product_id`,
			warehouseID, productIDs,
		).
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		costs[row.ProductID] = int64(math.Round(row.UnitCost))
	}

	return costs, nil
}
