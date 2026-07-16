package region_v1

import (
	"context"

	"connectrpc.com/connect"

	regionv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/region/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/region_service/region_service_models"
)

// RegionList returns the children of one region — the cascading picker's only query. An EMPTY
// parent_code means the top level (the 38 provinsi), which is `parent_code IS NULL`, not
// `parent_code = ''`: "no parent" is an absence.
//
// Ordered by name, because this feeds a human picking from a list, not a machine.
func (s *Service) RegionList(
	ctx context.Context,
	req *connect.Request[regionv1.RegionListRequest],
) (*connect.Response[regionv1.RegionListResponse], error) {
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&region_service_models.Region{})

	if parent := req.Msg.GetParentCode(); parent == "" {
		query = query.Where("parent_code IS NULL")
	} else {
		query = query.Where("parent_code = ?", parent)
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var rows []region_service_models.Region

	err = query.
		Order("name ASC, code ASC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	out := make([]*regionv1.Region, 0, len(rows))
	for i := range rows {
		out = append(out, regionToProto(&rows[i]))
	}

	return connect.NewResponse(&regionv1.RegionListResponse{
		Regions:  out,
		PageInfo: pageInfo(page, total),
	}), nil
}
