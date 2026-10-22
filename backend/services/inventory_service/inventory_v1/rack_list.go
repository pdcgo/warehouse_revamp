package inventory_v1

import (
	"context"
	"slices"
	"strings"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RackList returns the scoped warehouse's active racks, paginated. `q` filters by code or name.
//
// Ordered by CODE, not newest-first: a rack list is read by someone walking the aisles, and the label
// is how they find it. (Suppliers are id DESC because a vendor list is read as "what did we add".)
func (s *Service) RackList(
	ctx context.Context,
	req *connect.Request[inventoryv1.RackListRequest],
) (*connect.Response[inventoryv1.RackListResponse], error) {
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&inventory_service_models.Rack{}).
		Where("warehouse_id = ? AND deleted_at IS NULL", req.Msg.GetTeamId())

	if q := strings.TrimSpace(req.Msg.GetFilter().GetQ()); q != "" {
		pattern := "%" + escapeLike(q) + "%"
		query = query.Where("code ILIKE ? OR name ILIKE ?", pattern, pattern)
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, rackDBError(err)
	}

	var racks []inventory_service_models.Rack

	err = query.
		Order(rackOrderClause(req.Msg.GetSort())).
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&racks).
		Error
	if err != nil {
		return nil, rackDBError(err)
	}

	// The STOCK slice is read only when asked for: a picker wants codes, and summing every shelf for it would be a
	// query nobody reads.
	var totals map[uint64]rackTotal

	if slices.Contains(req.Msg.GetDataRequest(), inventoryv1.RackListDataType_RACK_LIST_DATA_TYPE_STOCK) {
		totals, err = s.rackStockTotals(ctx, req.Msg.GetTeamId(), racks)
		if err != nil {
			return nil, rackDBError(err)
		}
	}

	items, ids := rackListItems(racks, req.Msg.GetDataRequest(), totals)

	return connect.NewResponse(&inventoryv1.RackListResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}

// rackTotal is one rack's line in the Racks list: its stock count, and how many different products make it up.
type rackTotal struct {
	StockCount   int64
	ProductCount uint32
}

// rackStockTotals is each rack's stock count — the sum of its products' on-hand, the same rows Rack detail's header
// totals (a-rack-shows-its-stock-count-for-now) — and its product count. ONE grouped query for the page's racks, never
// one per rack.
//
// The product count is COUNT(*), not COUNT(DISTINCT product_id): a rack row is one product on one rack (UNIQUE on
// product and rack), so the rows ARE the distinct products. A row that fell to 0 is not on the rack.
//
// A rack holding nothing is absent from the result and reads 0 and 0: the slice answers for every rack on the page.
func (s *Service) rackStockTotals(
	ctx context.Context,
	warehouseID uint64,
	racks []inventory_service_models.Rack,
) (map[uint64]rackTotal, error) {
	totals := make(map[uint64]rackTotal, len(racks))
	if len(racks) == 0 {
		return totals, nil
	}

	ids := make([]uint64, 0, len(racks))
	for i := range racks {
		ids = append(ids, racks[i].ID)
	}

	var rows []struct {
		RackID   uint64
		Total    int64
		Products uint32
	}

	err := s.db.
		WithContext(ctx).
		Model(&inventory_service_models.ProductPlacement{}).
		Select("placement_id AS rack_id, SUM(stock_count) AS total, COUNT(*) AS products").
		Where("warehouse_id = ? AND placement_id IN ? AND stock_count > 0", warehouseID, ids).
		Group("placement_id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		totals[row.RackID] = rackTotal{StockCount: row.Total, ProductCount: row.Products}
	}

	return totals, nil
}
