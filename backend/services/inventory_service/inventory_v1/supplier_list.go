package inventory_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// SupplierList returns the scoped team's active suppliers, newest first, paginated. `q` filters by
// name or code.
func (s *Service) SupplierList(
	ctx context.Context,
	req *connect.Request[inventoryv1.SupplierListRequest],
) (*connect.Response[inventoryv1.SupplierListResponse], error) {
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&inventory_service_models.Supplier{}).
		Where("team_id = ? AND deleted = ?", req.Msg.GetTeamId(), false)

	if q := strings.TrimSpace(req.Msg.GetQ()); q != "" {
		pattern := "%" + escapeLike(q) + "%"
		query = query.Where("name ILIKE ? OR code ILIKE ?", pattern, pattern)
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, supplierDBError(err)
	}

	var suppliers []inventory_service_models.Supplier

	err = query.
		Order("id DESC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&suppliers).
		Error
	if err != nil {
		return nil, supplierDBError(err)
	}

	out := make([]*inventoryv1.Supplier, 0, len(suppliers))
	for i := range suppliers {
		out = append(out, supplierToProto(&suppliers[i]))
	}

	return connect.NewResponse(&inventoryv1.SupplierListResponse{
		Suppliers: out,
		PageInfo:  pageInfo(page, total),
	}), nil
}
