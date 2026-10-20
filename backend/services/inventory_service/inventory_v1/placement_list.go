package inventory_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// PlacementList backs the product detail's PLACEMENT tab (#209): where a product sits, per shelf, with
// the last time stock left, arrived, and was counted there. A stale Last-opname is what flags a shelf
// overdue for a stock-take — the whole reason the dates ride beside the quantity.
//
// On-hand per rack is the placement ledger's rack row; the dates are maxima over its log. Only racks that hold
// something are listed — a depleted rack is not where the product "sits".
func (s *Service) PlacementList(
	ctx context.Context,
	req *connect.Request[inventoryv1.PlacementListRequest],
) (*connect.Response[inventoryv1.PlacementListResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	productID := req.Msg.GetFilter().GetProductId()
	page := req.Msg.GetPage()

	var total int64

	err := s.db.WithContext(ctx).
		Raw(`SELECT COUNT(*) FROM product_placements WHERE warehouse_id = ? AND product_id = ? AND stock_count > 0`,
			warehouseID, productID).
		Scan(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	type row struct {
		RackID     uint64
		OnHand     int64
		LastOut    *time.Time
		LastIn     *time.Time
		LastOpname *time.Time
	}

	var rows []row

	offset := int((page.GetPage() - 1) * page.GetLimit())

	// The three dates are correlated maxima over THIS rack row's log. Last opname is the last `adjustment` row — a
	// count writes one even when it finds the rack exact, so the rack reads as counted.
	err = s.db.WithContext(ctx).
		Raw(`
			SELECT
			    pp.placement_id AS rack_id,
			    pp.stock_count AS on_hand,
			    (SELECT MAX(l.created_at) FROM product_placement_logs l
			       WHERE l.product_id = pp.product_id AND l.placement_id = pp.placement_id AND l.stock_change < 0) AS last_out,
			    (SELECT MAX(l.created_at) FROM product_placement_logs l
			       WHERE l.product_id = pp.product_id AND l.placement_id = pp.placement_id AND l.stock_change > 0) AS last_in,
			    (SELECT MAX(l.created_at) FROM product_placement_logs l
			       WHERE l.product_id = pp.product_id AND l.placement_id = pp.placement_id AND l.change_type = ?) AS last_opname
			FROM product_placements pp
			WHERE pp.warehouse_id = ? AND pp.product_id = ? AND pp.stock_count > 0
			ORDER BY pp.placement_id ASC
			LIMIT ? OFFSET ?`,
			string(inventory_service_models.TxAdjustment),
			warehouseID, productID, int(page.GetLimit()), offset).
		Scan(&rows).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	placements := make([]*inventoryv1.ProductPlacement, 0, len(rows))
	for i := range rows {
		p := &inventoryv1.ProductPlacement{RackId: rows[i].RackID, OnHand: rows[i].OnHand}

		if rows[i].LastOut != nil {
			p.LastOutUnix = rows[i].LastOut.Unix()
		}
		if rows[i].LastIn != nil {
			p.LastInUnix = rows[i].LastIn.Unix()
		}
		if rows[i].LastOpname != nil {
			p.LastOpnameUnix = rows[i].LastOpname.Unix()
		}

		placements = append(placements, p)
	}

	items, ids := placementItems(placements, req.Msg.GetDataRequest())

	return connect.NewResponse(&inventoryv1.PlacementListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   pageCount(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
