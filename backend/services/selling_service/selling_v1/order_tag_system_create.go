package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
)

// OrderTagSystemCreate makes a SYSTEM order tag — Root / the Administrator only (the request's policy). The same
// one-name-one-tag answer as OrderTagCreate: a name already taken answers that tag, whatever its type.
func (s *Service) OrderTagSystemCreate(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderTagSystemCreateRequest],
) (*connect.Response[sellingv1.OrderTagSystemCreateResponse], error) {
	tag, created, err := s.createOrderTag(ctx, req.Msg.GetName(), orderTagSystem)
	if err != nil {
		return nil, orderTagErr(err)
	}

	return connect.NewResponse(&sellingv1.OrderTagSystemCreateResponse{Tag: tag, Created: created}), nil
}
