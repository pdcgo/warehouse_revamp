package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// CostLayerList backs the product detail's PRICES tab (#209): the warehouse's on-hand of one product,
// grouped by the FROZEN COST it carries. Batches that arrived at the same price form one layer; the
// value of the shelf is the sum across layers, not on-hand × a single price.
//
// A batch with no cost basis is its OWN layer with `cost_known = false` — "Unknown", never Rp 0 (#74),
// and it does not count toward the header total. Depleted layers (nothing ready) drop out.
func (s *Service) CostLayerList(
	ctx context.Context,
	req *connect.Request[inventoryv1.CostLayerListRequest],
) (*connect.Response[inventoryv1.CostLayerListResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	productID := req.Msg.GetProductId()
	page := req.Msg.GetPage()

	// One layer per distinct frozen cost, its on-hand the Ready across every batch at that price. NULL
	// cost groups on its own (the Unknown layer). Only layers that still hold stock are shown.
	const grouped = `
		SELECT unit_cost, SUM(ready) AS on_hand
		FROM (
			SELECT b.unit_cost,
			       COALESCE((SELECT SUM(sb.qty) FROM stock_shelf_batches sb WHERE sb.batch_id = b.id), 0) AS ready
			FROM stock_batches b
			WHERE b.warehouse_id = ? AND b.product_id = ?
		) x
		GROUP BY unit_cost
		HAVING SUM(ready) > 0`

	var total int64

	err := s.db.WithContext(ctx).
		Raw("SELECT COUNT(*) FROM ("+grouped+") g", warehouseID, productID).
		Scan(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// The header total values every KNOWN-cost layer; an unknown layer is worth "Unknown", not 0 (#74).
	var totalValue int64

	err = s.db.WithContext(ctx).
		Raw("SELECT COALESCE(SUM(on_hand * unit_cost), 0) FROM ("+grouped+") g WHERE unit_cost IS NOT NULL",
			warehouseID, productID).
		Scan(&totalValue).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	type row struct {
		UnitCost *int64
		OnHand   int64
	}

	var rows []row

	offset := int((page.GetPage() - 1) * page.GetLimit())

	// Dearest first, Unknown last — the same order the Prices tab reads top-down.
	err = s.db.WithContext(ctx).
		Raw(grouped+" ORDER BY unit_cost DESC NULLS LAST LIMIT ? OFFSET ?",
			warehouseID, productID, int(page.GetLimit()), offset).
		Scan(&rows).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	layers := make([]*inventoryv1.CostLayer, 0, len(rows))
	for i := range rows {
		costKnown := rows[i].UnitCost != nil
		var unitCost int64
		if costKnown {
			unitCost = *rows[i].UnitCost
		}

		layers = append(layers, &inventoryv1.CostLayer{
			UnitCost:  unitCost,
			CostKnown: costKnown,
			OnHand:    rows[i].OnHand,
			Amount:    rows[i].OnHand * unitCost,
		})
	}

	return connect.NewResponse(&inventoryv1.CostLayerListResponse{
		Layers: layers,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   pageCount(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
		TotalValue: totalValue,
	}), nil
}
