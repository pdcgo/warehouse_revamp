package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// StockHistory returns the movement ledger for one product at the scoped warehouse (paged,
// newest-first) — so a wrong on-hand number is explainable.
func (s *Service) StockHistory(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockHistoryRequest],
) (*connect.Response[inventoryv1.StockHistoryResponse], error) {
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&inventory_service_models.StockMovement{}).
		Where("warehouse_id = ? AND product_id = ?", req.Msg.GetWarehouseId(), req.Msg.GetProductId())

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var movements []inventory_service_models.StockMovement

	err = query.
		Order("id DESC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&movements).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	out := make([]*inventoryv1.StockMovement, 0, len(movements))
	for i := range movements {
		out = append(out, movementToProto(&movements[i]))
	}

	return connect.NewResponse(&inventoryv1.StockHistoryResponse{
		Movements: out,
		PageInfo:  pageInfo(page, total),
	}), nil
}
