package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockRequestList serves BOTH sides of a request (#105): a team sees requests it MADE
// (requesting_team_id) and requests TARGETING it as a warehouse (warehouse_id). Newest first,
// paginated. The team_id is the caller's team (use_scope).
func (s *Service) RestockRequestList(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestListRequest],
) (*connect.Response[inventoryv1.RestockRequestListResponse], error) {
	teamID := req.Msg.GetTeamId()
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&inventory_service_models.RestockRequest{}).
		Where("requesting_team_id = ? OR warehouse_id = ?", teamID, teamID)

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, restockErr(err)
	}

	var rrs []inventory_service_models.RestockRequest

	err = query.
		// Preload, not a join: GORM fetches this page's lines in ONE extra query keyed by request id,
		// so a page of requests costs 2 queries rather than N+1 (#124).
		Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		Order("id DESC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&rrs).
		Error
	if err != nil {
		return nil, restockErr(err)
	}

	out := make([]*inventoryv1.RestockRequest, 0, len(rrs))
	for i := range rrs {
		out = append(out, restockRequestToProto(&rrs[i]))
	}

	return connect.NewResponse(&inventoryv1.RestockRequestListResponse{
		Requests: out,
		PageInfo: pageInfo(page, total),
	}), nil
}
