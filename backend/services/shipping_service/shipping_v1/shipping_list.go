package shipping_v1

import (
	"context"

	"connectrpc.com/connect"

	shippingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipping/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/shipping_service/shipping_service_models"
)

// ShippingList returns the courier catalogue, alphabetical by name. Active-only by default; set
// include_inactive to see retired couriers too.
func (s *Service) ShippingList(
	ctx context.Context,
	req *connect.Request[shippingv1.ShippingListRequest],
) (*connect.Response[shippingv1.ShippingListResponse], error) {
	query := s.db.WithContext(ctx).Order("name ASC")

	if !req.Msg.GetIncludeInactive() {
		query = query.Where("active = ?", true)
	}

	var rows []shipping_service_models.Shipping

	err := query.Find(&rows).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	data := make([]*shippingv1.Shipping, 0, len(rows))
	for i := range rows {
		data = append(data, toProto(&rows[i]))
	}

	return connect.NewResponse(&shippingv1.ShippingListResponse{Data: data}), nil
}
