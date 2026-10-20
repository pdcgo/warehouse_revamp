package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// StockList returns the on-hand of every product at the scoped warehouse (paged) — the placement ledger's rack rows,
// summed.
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
		Model(&inventory_service_models.ProductPlacement{}).
		Where("warehouse_id = ?", req.Msg.GetWarehouseId()).
		Group("warehouse_id, product_id")

	var total int64

	// COUNT the GROUPS, not the rows. GORM's Count() over a grouped query counts rows per group and
	// returns the first group's count (i.e. 1), so the total has to be counted around the grouping.
	err := s.db.
		WithContext(ctx).
		Raw(`SELECT COUNT(*) FROM (
		       SELECT 1 FROM product_placements WHERE warehouse_id = ? GROUP BY warehouse_id, product_id
		     ) g`, req.Msg.GetWarehouseId()).
		Scan(&total).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var levels []stockLevelRow

	err = query.
		Select("warehouse_id, product_id, SUM(stock_count) AS on_hand").
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
		out = append(out, levels[i].proto())
	}

	items, ids := stockLevelItems(out, req.Msg.GetDataRequest())

	return connect.NewResponse(&inventoryv1.StockListResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}

// stockLevelRow is one product's total in one warehouse.
type stockLevelRow struct {
	WarehouseID uint64
	ProductID   uint64
	OnHand      int64
}

func (r stockLevelRow) proto() *inventoryv1.StockLevel {
	return &inventoryv1.StockLevel{ProductId: r.ProductID, WarehouseId: r.WarehouseID, OnHand: r.OnHand}
}
