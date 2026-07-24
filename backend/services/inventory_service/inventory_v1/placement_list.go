package inventory_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// PlacementList backs the product detail's PLACEMENT tab (#209): where a product sits, per shelf, with
// the last time stock left, arrived, and was counted there. A stale Last-opname is what flags a shelf
// overdue for a stock-take — the whole reason the dates ride beside the quantity.
//
// On-hand per shelf is the derived stock_levels cache; the dates are aggregates over the ledger. Only
// shelves that hold something are listed — a depleted shelf is not where the product "sits".
func (s *Service) PlacementList(
	ctx context.Context,
	req *connect.Request[inventoryv1.PlacementListRequest],
) (*connect.Response[inventoryv1.PlacementListResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	productID := req.Msg.GetProductId()
	page := req.Msg.GetPage()

	var total int64

	err := s.db.WithContext(ctx).
		Raw(`SELECT COUNT(*) FROM stock_levels WHERE warehouse_id = ? AND product_id = ? AND on_hand > 0`,
			warehouseID, productID).
		Scan(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	type row struct {
		RackID     *uint64
		OnHand     int64
		LastOut    *time.Time
		LastIn     *time.Time
		LastOpname *time.Time
	}

	var rows []row

	offset := int((page.GetPage() - 1) * page.GetLimit())

	// The three dates are correlated maxima over the ledger for THIS shelf. `IS NOT DISTINCT FROM`
	// matches the unplaced pile (a NULL rack) the same way stock_levels' own writes do. Last opname is
	// the last ADJUST — a stock-take is recorded as an adjustment (kind 2).
	err = s.db.WithContext(ctx).
		Raw(`
			SELECT
			    sl.rack_id,
			    sl.on_hand,
			    (SELECT MAX(m.created_at) FROM stock_movements m
			       WHERE m.warehouse_id = sl.warehouse_id AND m.product_id = sl.product_id
			         AND m.rack_id IS NOT DISTINCT FROM sl.rack_id AND m.delta < 0) AS last_out,
			    (SELECT MAX(m.created_at) FROM stock_movements m
			       WHERE m.warehouse_id = sl.warehouse_id AND m.product_id = sl.product_id
			         AND m.rack_id IS NOT DISTINCT FROM sl.rack_id AND m.delta > 0) AS last_in,
			    (SELECT MAX(m.created_at) FROM stock_movements m
			       WHERE m.warehouse_id = sl.warehouse_id AND m.product_id = sl.product_id
			         AND m.rack_id IS NOT DISTINCT FROM sl.rack_id AND m.kind = ?) AS last_opname
			FROM stock_levels sl
			WHERE sl.warehouse_id = ? AND sl.product_id = ? AND sl.on_hand > 0
			ORDER BY sl.rack_id ASC NULLS LAST
			LIMIT ? OFFSET ?`,
			int32(inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST),
			warehouseID, productID, int(page.GetLimit()), offset).
		Scan(&rows).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	placements := make([]*inventoryv1.ProductPlacement, 0, len(rows))
	for i := range rows {
		p := &inventoryv1.ProductPlacement{OnHand: rows[i].OnHand}

		// A nil rack is the unplaced pile — 0 on the wire (#135).
		if rows[i].RackID != nil {
			p.RackId = *rows[i].RackID
		}
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

	return connect.NewResponse(&inventoryv1.PlacementListResponse{
		Placements: placements,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   pageCount(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
