package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// StockList returns the on-hand of every product at the scoped warehouse (paged) — reading the
// derived snapshot, not the ledger.
func (s *Service) StockList(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockListRequest],
) (*connect.Response[inventoryv1.StockListResponse], error) {
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&inventory_service_models.StockLevel{}).
		Where("warehouse_id = ?", req.Msg.GetWarehouseId())

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var levels []inventory_service_models.StockLevel

	err = query.
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
