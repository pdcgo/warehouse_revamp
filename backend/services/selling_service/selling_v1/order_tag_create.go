package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
)

// OrderTagCreate makes a CUSTOM order tag — anyone who may write on an order, on either side (every role but a monitor;
// a monitor reaches reads only). ONE NAME, ONE TAG: a name already on the orders' list, any case and spaces folded,
// answers that tag — whatever its type — and never makes a twin (createOrderTag). A restock tag's name is free here
// (orders-have-their-own-tag-list).
func (s *Service) OrderTagCreate(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderTagCreateRequest],
) (*connect.Response[sellingv1.OrderTagCreateResponse], error) {
	tag, created, err := s.createOrderTag(ctx, req.Msg.GetName(), orderTagCustom)
	if err != nil {
		return nil, orderTagErr(err)
	}

	return connect.NewResponse(&sellingv1.OrderTagCreateResponse{Tag: tag, Created: created}), nil
}
