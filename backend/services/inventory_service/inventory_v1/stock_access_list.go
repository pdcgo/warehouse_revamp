package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// StockAccessList returns who may currently draw stock from this warehouse (#147) — ACTIVE grants
// only, newest first, paginated.
//
// Revoked rows are excluded rather than flagged: this list answers "who can take our stock right now",
// and a revoked arrangement is not an answer to that. The rows survive for audit, which is a different
// question and will want a different screen if it is ever asked.
func (s *Service) StockAccessList(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockAccessListRequest],
) (*connect.Response[inventoryv1.StockAccessListResponse], error) {
	page := req.Msg.GetPage()

	// The warehouse_id clause IS the scope check.
	query := s.db.
		WithContext(ctx).
		Model(&inventory_service_models.StockAccessGrant{}).
		Where("warehouse_id = ? AND revoked = ?", req.Msg.GetTeamId(), false)

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, stockAccessErr(err)
	}

	var grants []inventory_service_models.StockAccessGrant

	err = query.
		Order("id DESC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&grants).
		Error
	if err != nil {
		return nil, stockAccessErr(err)
	}

	out := make([]*inventoryv1.StockAccessGrant, 0, len(grants))
	for i := range grants {
		out = append(out, stockAccessGrantToProto(&grants[i]))
	}

	return connect.NewResponse(&inventoryv1.StockAccessListResponse{
		Grants:   out,
		PageInfo: pageInfo(page, total),
	}), nil
}
