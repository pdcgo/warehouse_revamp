package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// OwnerCostLayerList is the PRICE tab of the catalogue owner's product detail (#232): its units of one product grouped
// by the price each batch carries — the same question CostLayerList answers for a warehouse, asked by the team that
// owns the goods.
//
//   - Ownership replaces the warehouse scope: `batches.team_id`, written at mint (a-batch-carries-its-owner), so the
//     layers are the caller's units wherever they sit.
//   - The warehouse is a LENS on top, not the scope. Unset, the layers span every building holding these goods; set,
//     they describe one.
func (s *Service) OwnerCostLayerList(
	ctx context.Context,
	req *connect.Request[inventoryv1.OwnerCostLayerListRequest],
) (*connect.Response[inventoryv1.OwnerCostLayerListResponse], error) {
	page := req.Msg.GetPage()

	where := "b.team_id = ? AND b.product_id = ?"
	args := []any{req.Msg.GetTeamId(), req.Msg.GetFilter().GetProductId()}

	if warehouseID := req.Msg.GetFilter().GetWarehouseId(); warehouseID > 0 {
		where += " AND b.warehouse_id = ?"
		args = append(args, warehouseID)
	}

	layers, total, totalValue, err := costLayers(s.db.WithContext(ctx), page, where, args...)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	items, ids := ownerCostLayerItems(layers, req.Msg.GetDataRequest())

	return connect.NewResponse(&inventoryv1.OwnerCostLayerListResponse{
		Items:      items,
		Ids:        ids,
		PageInfo:   pageInfo(page, total),
		TotalValue: totalValue,
	}), nil
}
