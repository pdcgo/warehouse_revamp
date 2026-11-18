package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RackStat answers the Racks list's card strip (the-rack-list-leads-with-its-figures): how many racks the list matches,
// how many of them hold something, how many hold nothing, and the pieces on them all — over EVERY rack the list matches,
// whatever page it is on. Until this read the three past *Rak* were summed from the page's racks and marked missing once
// the racks ran past one page.
//
// The racks are RackList's own (rackListScope — the search narrows the figures too), and a rack's stock is RackList's
// STOCK slice for it: its products' stock counts summed, a level at 0 not counted (rackStockTotals). So a rack is FILLED
// when that sum is above 0 and EMPTY when it is 0, exactly as its row reads *Kosong* (an-empty-rack-says-so).
//
// ONE statement: the warehouse's shelf rows summed per rack, left-joined to the matched racks, then counted and summed.
func (s *Service) RackStat(
	ctx context.Context,
	req *connect.Request[inventoryv1.RackStatRequest],
) (*connect.Response[inventoryv1.RackStatResponse], error) {
	warehouseID := req.Msg.GetTeamId()

	var row struct {
		Racks  int64
		Filled int64
		Stock  int64
	}

	err := rackListScope(s.db.WithContext(ctx), warehouseID, req.Msg.GetFilter()).
		Joins(`LEFT JOIN (
			SELECT placement_id, SUM(stock_count) AS total
			FROM product_placements
			WHERE warehouse_id = ? AND stock_count > 0
			GROUP BY placement_id
		) shelf ON shelf.placement_id = placements.id`, warehouseID).
		Select(`COUNT(*) AS racks,
			COUNT(*) FILTER (WHERE shelf.total > 0) AS filled,
			COALESCE(SUM(shelf.total), 0) AS stock`).
		Scan(&row).
		Error
	if err != nil {
		return nil, rackDBError(err)
	}

	return connect.NewResponse(&inventoryv1.RackStatResponse{
		Preview: &inventoryv1.RackPreview{
			RackCount:   row.Racks,
			FilledCount: row.Filled,
			EmptyCount:  row.Racks - row.Filled,
			StockCount:  row.Stock,
		},
	}), nil
}
