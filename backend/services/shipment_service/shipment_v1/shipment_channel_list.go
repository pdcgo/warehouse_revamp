package shipment_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_service_models"
)

// ShipmentChannelList pages the catalogue. Live channels only unless `include_deleted` — the picker and
// the third-party app leave it off; the management page sets it to find a channel to restore. `q`
// matches code or name.
func (s *Service) ShipmentChannelList(
	ctx context.Context,
	req *connect.Request[shipmentv1.ShipmentChannelListRequest],
) (*connect.Response[shipmentv1.ShipmentChannelListResponse], error) {
	page := req.Msg.GetPage()
	filter := req.Msg.GetFilter()

	query := s.db.
		WithContext(ctx).
		Model(&shipment_service_models.ShipmentChannel{})

	if !filter.GetIncludeDeleted() {
		query = query.Where("is_deleted = ?", false)
	}

	if q := strings.TrimSpace(filter.GetQ()); q != "" {
		pattern := "%" + escapeLike(q) + "%"
		query = query.Where("name ILIKE ? OR code ILIKE ?", pattern, pattern)
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var channels []shipment_service_models.ShipmentChannel

	err = query.
		Order(orderClause(req.Msg.GetSort())).
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&channels).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	items, ids := listItems(channels, req.Msg.GetDataRequest())

	return connect.NewResponse(&shipmentv1.ShipmentChannelListResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}
