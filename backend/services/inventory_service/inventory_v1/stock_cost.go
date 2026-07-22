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
	costs, err := s.unitCosts(ctx, req.Msg.GetWarehouseId(), req.Msg.GetProductIds())
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

	return connect.NewResponse(&inventoryv1.StockCostResponse{Costs: out}), nil
}

// unitCosts is the HPP query itself, shared by StockCost and by the rack's valuation (#197).
//
// Extracted rather than copied, and that is the whole point: the formula below is the owner's, it has
// four documented rounding decisions in it, and a second copy would be a second answer to "what did
// this cost" the first time either was tweaked.
//
// A product with NO restock history is ABSENT from the map, never present as 0 — "we do not know what
// this cost" and "this cost nothing" are different facts, and collapsing them lets a caller compute a
// margin, or value a shelf, as if the goods were free.
func (s *Service) unitCosts(
	ctx context.Context,
	warehouseID uint64,
	productIDs []uint64,
) (map[uint64]int64, error) {
	costs := map[uint64]int64{}

	// An empty id list would make `IN ?` invalid SQL, and "the cost of nothing" is an empty map rather
	// than an error.
	if len(productIDs) == 0 {
		return costs, nil
	}

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
			       -- HPP — WHAT THE GOODS COST TO GET HERE (#155, owner's formula):
			       --
			       --   additional = (shipping_cost + cod_shipping_fee) / sellable units on the request
			       --   hpp        = (line total / line's sellable units) + additional
			       --
			       -- Freight is part of what a product costs, so an order's COGS carries it. Before
			       -- this it did not, and every margin was quietly optimistic by the freight.
			       --
			       -- Divided by SELLABLE units, not by everything that arrived (owner, 2026-07-20).
			       -- You paid to ship the broken ones too, and that cost has to land somewhere: the
			       -- good units carry it, so a damaged delivery correctly reads as more expensive per
			       -- piece rather than hiding the loss.
			       --
			       -- Both divisions are integer and round DOWN, deliberately: an order that rounded up
			       -- would claim to have paid more than the invoice says. The dropped rupiah is never
			       -- written back over the stored totals (#140).
			       ((i.total_price / i.received_quantity) + COALESCE(f.additional, 0)) AS unit_cost
			FROM restock_request_items i
			JOIN restock_requests r ON r.id = i.restock_request_id
			-- The freight share is a property of the WHOLE REQUEST, so it is computed once per request
			-- and applies to each of its lines. Spread by UNIT COUNT (owner): every unit carries the
			-- same freight whichever line it sits on, which is what "all stock count" means.
			LEFT JOIN LATERAL (
			    -- SUM() returns NUMERIC, and bigint / numeric is a numeric — a decimal that will not
			      -- scan into an int64 and would not have floored anyway. Cast the divisor back to
			      -- BIGINT so this stays integer division, rounding down like every other figure here.
			    SELECT (r.shipping_cost + r.cod_shipping_fee)
			           / NULLIF(SUM(x.received_quantity)::BIGINT, 0) AS additional
			    FROM restock_request_items x
			    WHERE x.restock_request_id = r.id
			) f ON TRUE
			WHERE r.warehouse_id = ?
			  AND r.status = ?
			  AND i.product_id IN ?
			  -- A line that brought nothing has no cost basis: dividing by its zero would fail, and
			  -- "what did the units cost" has no answer when no units came. Such a line is skipped, so
			  -- the product falls back to its previous delivery rather than to a fabricated figure.
			  AND i.received_quantity > 0
			ORDER BY i.product_id, r.id DESC`,
			warehouseID, restockStatusFulfilled, productIDs,
		).
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	for i := range rows {
		costs[rows[i].ProductID] = rows[i].UnitCost
	}

	return costs, nil
}
