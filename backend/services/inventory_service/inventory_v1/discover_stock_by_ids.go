package inventory_v1

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// DiscoverStockByIds answers a Discover page's card figures for products of ANY team: ready stock and stock on its way
// (a-discover-card-shows-its-stock), the ready stock of every warehouse that the lock badge reads
// (a-discover-card-says-locked-as-the-title-does), and the cross price range (discover-shows-the-cross-price) — in one
// warehouse when one is given (discovers-warehouse-keeps-ready-stock-there), else every warehouse.
//
// ── Never the cost ──────────────────────────────────────────────────────────────────────────────
//
// Another team's unit cost is not readable across teams. The cross price — what a borrower pays — is the cost with the
// product's markup on top, the take's own formula (inventory-computes-the-markup: cost + cost × bps ÷ 10 000), so it is
// computed HERE from the batches and the markup product_service holds, and only the result leaves. The caller's own
// products' cost still comes from OwnerStockByIds.
//
// ── One call per page, three statements ─────────────────────────────────────────────────────────
//
// The owners and markups of the page's products (ProductReader.Facts, one ProductByIds), then ONE grouped read of their
// owners' live batches — ready in the lens, ready everywhere and the cost spread side by side — and ONE of their
// restock lines not yet accepted. However many products the page holds; never one read per product.
func (s *Service) DiscoverStockByIds(
	ctx context.Context,
	req *connect.Request[inventoryv1.DiscoverStockByIdsRequest],
) (*connect.Response[inventoryv1.DiscoverStockByIdsResponse], error) {
	productIDs := req.Msg.GetProductIds()
	warehouseID := req.Msg.GetWarehouseId()

	facts, err := s.products.Facts(ctx, req.Msg.GetTeamId(), productIDs)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("ask product facts: %w", err))
	}

	// Only products that exist are read: an unknown id has no owner and answers zeros.
	teams := make([]int64, 0, len(productIDs))
	products := make([]int64, 0, len(productIDs))

	for _, id := range productIDs {
		fact, ok := facts[id]
		if !ok {
			continue
		}

		teams = append(teams, int64(fact.TeamID))
		products = append(products, int64(id))
	}

	shelves := map[uint64]discoverShelfScan{}
	ongoing := map[uint64]int64{}

	if len(products) > 0 {
		db := s.db.WithContext(ctx)

		shelves, err = discoverShelves(db, teams, products, warehouseID)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		ongoing, err = discoverOngoing(db, teams, products, warehouseID)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	items := make([]*inventoryv1.DiscoverStockItem, 0, len(productIDs))

	for _, id := range productIDs {
		item := &inventoryv1.DiscoverStockItem{ProductId: id, OngoingQty: ongoing[id]}

		shelf, ok := shelves[id]
		if ok {
			item.ReadyQty = shelf.Ready
			item.TotalReadyQty = shelf.TotalReady

			// The cost spread is read only to price it: it is turned into the cross price here and never sent.
			if shelf.CostMin != nil && shelf.CostMax != nil {
				bps := facts[id].CrossMarkupBps
				item.CrossKnown = true
				item.CrossMin = crossPriceOf(*shelf.CostMin, bps)
				item.CrossMax = crossPriceOf(*shelf.CostMax, bps)
			}
		}

		items = append(items, item)
	}

	return connect.NewResponse(&inventoryv1.DiscoverStockByIdsResponse{Items: items}), nil
}

// crossPriceOf is what another team pays for a unit that cost `cost`: the cost with the markup on top, exact — the take
// prices a borrowed line the same way (pricedTake, order_transaction_create.go), and the screens' withMarkup too.
func crossPriceOf(cost float64, bps uint32) float64 {
	return cost + cost*float64(bps)/10000
}

// discoverShelfScan is one product's shelf-side figures: ready in the lens, ready everywhere, and the spread of the unit
// costs of the batches holding units in the lens (nil when none does).
type discoverShelfScan struct {
	ProductID  uint64
	Ready      int64
	TotalReady int64
	CostMin    *float64
	CostMax    *float64
}

// discoverShelves sums the owners' live batches once, grouped by product. `stock_count > 0` changes no sum — an emptied
// batch adds 0 — keeps an emptied batch's price out of the spread, and lets the planner read the partial
// batches_owner_product_idx. The lens is a FILTER on the aggregate, not a WHERE, so the same rows also give the every-
// warehouse total the lock reads.
func discoverShelves(db *gorm.DB, teams, products []int64, warehouseID uint64) (map[uint64]discoverShelfScan, error) {
	var rows []discoverShelfScan

	err := db.Raw(`
WITH c AS (
    SELECT *
    FROM unnest(CAST(@teams AS bigint[]), CAST(@products AS bigint[])) AS c(team_id, product_id)
)
SELECT b.product_id AS product_id,
       COALESCE(SUM(b.stock_count) FILTER (WHERE CAST(@warehouse AS bigint) = 0 OR b.warehouse_id = @warehouse), 0) AS ready,
       COALESCE(SUM(b.stock_count), 0) AS total_ready,
       MIN(b.price_unit) FILTER (WHERE CAST(@warehouse AS bigint) = 0 OR b.warehouse_id = @warehouse) AS cost_min,
       MAX(b.price_unit) FILTER (WHERE CAST(@warehouse AS bigint) = 0 OR b.warehouse_id = @warehouse) AS cost_max
FROM batches b
JOIN c ON c.team_id = b.team_id AND c.product_id = b.product_id
WHERE b.stock_count > 0
GROUP BY b.product_id`,
		map[string]any{
			"teams":     int64Array(teams),
			"products":  int64Array(products),
			"warehouse": int64(warehouseID),
		},
	).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("discover shelves, %d product(s): %w", len(products), err)
	}

	out := make(map[uint64]discoverShelfScan, len(rows))
	for _, row := range rows {
		out[row.ProductID] = row
	}

	return out, nil
}

// discoverOngoing sums the units on their way: the owners' restock lines the warehouse has not accepted yet — the
// owner's own figure's rule (ownerOngoingRows), for many owners at once. A restock carries only its team's own products
// (a-restock-carries-only-the-teams-own-products), so the line's team is the product's owner.
func discoverOngoing(db *gorm.DB, teams, products []int64, warehouseID uint64) (map[uint64]int64, error) {
	var rows []struct {
		ProductID uint64
		Qty       int64
	}

	err := db.Raw(`
WITH c AS (
    SELECT *
    FROM unnest(CAST(@teams AS bigint[]), CAST(@products AS bigint[])) AS c(team_id, product_id)
)
SELECT ri.product_id AS product_id, COALESCE(SUM(ri.count), 0) AS qty
FROM restock_items ri
JOIN restocks r ON r.id = ri.restock_id
JOIN c ON c.team_id = r.team_id AND c.product_id = ri.product_id
WHERE r.status IN @statuses
  AND (CAST(@warehouse AS bigint) = 0 OR r.warehouse_id = @warehouse)
GROUP BY ri.product_id`,
		map[string]any{
			"teams":     int64Array(teams),
			"products":  int64Array(products),
			"statuses":  restockInboundStatuses,
			"warehouse": int64(warehouseID),
		},
	).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("discover ongoing, %d product(s): %w", len(products), err)
	}

	out := make(map[uint64]int64, len(rows))
	for _, row := range rows {
		out[row.ProductID] = row.Qty
	}

	return out, nil
}
