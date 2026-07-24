package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// StockList returns the on-hand of every product at the scoped warehouse (paged) — reading the
// derived snapshot, not the ledger.
//
// One row PER PRODUCT, summed across its racks (#135). This is the warehouse's answer to "how much of
// X do we have here?", and that has never meant "on which shelf" — a product on three racks is one
// line here, holding the total.
//
// The GROUP BY is what keeps this list honest now that a product can occupy several rows. Without it
// the same product would appear once per rack, and `total` — a COUNT of ROWS — would count places
// rather than products: the page size would silently shrink as a warehouse spread its stock around,
// and a product on two shelves would read as two products. "What is on rack A-01-3" is a different
// question with a different screen (#138).
func (s *Service) StockList(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockListRequest],
) (*connect.Response[inventoryv1.StockListResponse], error) {
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&inventory_service_models.StockLevel{}).
		Where("warehouse_id = ?", req.Msg.GetWarehouseId()).
		Group("warehouse_id, product_id")

	var total int64

	// COUNT the GROUPS, not the rows. GORM's Count() over a grouped query counts rows per group and
	// returns the first group's count (i.e. 1), so the total has to be counted around the grouping.
	err := s.db.
		WithContext(ctx).
		Raw(`SELECT COUNT(*) FROM (
		       SELECT 1 FROM stock_levels WHERE warehouse_id = ? GROUP BY warehouse_id, product_id
		     ) g`, req.Msg.GetWarehouseId()).
		Scan(&total).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var levels []inventory_service_models.StockLevel

	err = query.
		Select("warehouse_id, product_id, SUM(on_hand) AS on_hand, MAX(updated_at) AS updated_at").
		Order("product_id ASC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&levels).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	out := make([]*inventoryv1.StockLevel, 0, len(levels))
	for i := range levels {
		out = append(out, levelToProto(&levels[i]))
	}

	return connect.NewResponse(&inventoryv1.StockListResponse{
		Levels:   out,
		PageInfo: pageInfo(page, total),
	}), nil
}
