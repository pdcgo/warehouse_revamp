package inventory_v1

import (
	"context"
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
		Where("warehouse_id = ? AND deleted = ?", req.Msg.GetTeamId(), false)

	if q := strings.TrimSpace(req.Msg.GetQ()); q != "" {
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
		Order("code ASC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&racks).
		Error
	if err != nil {
		return nil, rackDBError(err)
	}

	out := make([]*inventoryv1.Rack, 0, len(racks))
	for i := range racks {
		out = append(out, rackToProto(&racks[i]))
	}

	return connect.NewResponse(&inventoryv1.RackListResponse{
		Racks:    out,
		PageInfo: pageInfo(page, total),
	}), nil
}
