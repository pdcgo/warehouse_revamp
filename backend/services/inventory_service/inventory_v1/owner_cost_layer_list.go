package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// OwnerCostLayerList is the PRICE tab of the catalogue owner's product detail (#232): its on-hand of
// one product grouped by the FROZEN COST each unit carries.
//
// The same question CostLayerList answers for a warehouse, asked by the team that owns the goods. Two
// differences, and both are the reason it exists:
//
//   - Ownership replaces the warehouse scope. `WHERE b.warehouse_id = ?` becomes the restock climb, so
//     the layers are the caller's units wherever they sit — which is the only version of this figure a
//     selling team can act on, because it buys for a catalogue and not for a building.
//   - The warehouse is a LENS on top, not the scope. Unset, the layers span every building holding
//     these goods; set, they describe one. A spread that silently meant "in Jakarta only" would be a
//     wrong number rather than a narrow one.
//
// Unknown-cost units are their own layer, `cost_known = false` — "Unknown", never Rp 0 (#74) — and
// they do not count toward the header total. Depleted layers drop out.
func (s *Service) OwnerCostLayerList(
	ctx context.Context,
	req *connect.Request[inventoryv1.OwnerCostLayerListRequest],
) (*connect.Response[inventoryv1.OwnerCostLayerListResponse], error) {
	teamID := req.Msg.GetTeamId()
	productID := req.Msg.GetFilter().GetProductId()
	warehouseID := req.Msg.GetFilter().GetWarehouseId()
	page := req.Msg.GetPage()

	// One layer per distinct frozen cost, its on-hand the Ready across every OWNED batch at that price.
	// NULL cost groups on its own (the Unknown layer); only layers still holding stock are shown.
	grouped := `
		SELECT unit_cost, SUM(ready) AS on_hand
		FROM (
			SELECT b.unit_cost,
			       COALESCE((SELECT SUM(sb.qty) FROM stock_shelf_batches sb WHERE sb.batch_id = b.id), 0) AS ready
			FROM stock_batches b
			JOIN restock_request_items ri ON ri.id = b.restock_request_item_id
			JOIN restock_requests r ON r.id = ri.restock_request_id
			WHERE r.requesting_team_id = ? AND b.product_id = ?`

	args := []any{teamID, productID}

	if warehouseID > 0 {
		grouped += ` AND b.warehouse_id = ?`
		args = append(args, warehouseID)
	}

	grouped += `
		) x
		GROUP BY unit_cost
		HAVING SUM(ready) > 0`

	db := s.db.WithContext(ctx)

	var total int64

	err := db.Raw("SELECT COUNT(*) FROM ("+grouped+") g", args...).Scan(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// The header total values every KNOWN-cost layer; an unknown layer is worth "Unknown", not 0 (#74).
	var totalValue int64

	err = db.
		Raw("SELECT COALESCE(SUM(on_hand * unit_cost), 0) FROM ("+grouped+") g WHERE unit_cost IS NOT NULL", args...).
		Scan(&totalValue).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	type row struct {
		UnitCost *int64
		OnHand   int64
	}

	var rows []row

	// Dearest first, Unknown last — the same order the tab reads top-down.
	err = db.
		Raw(grouped+" ORDER BY unit_cost DESC NULLS LAST LIMIT ? OFFSET ?",
			append(append([]any{}, args...), int(page.GetLimit()), pageOffset(page))...).
		Scan(&rows).
		Error
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

	items, ids := ownerCostLayerItems(layers, req.Msg.GetDataRequest())

	return connect.NewResponse(&inventoryv1.OwnerCostLayerListResponse{
		Items:      items,
		Ids:        ids,
		PageInfo:   pageInfo(page, total),
		TotalValue: totalValue,
	}), nil
}
