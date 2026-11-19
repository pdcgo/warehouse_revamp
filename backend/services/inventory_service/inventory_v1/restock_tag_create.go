package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RestockTagCreate makes a CUSTOM tag — anyone who may tag a restock, on either side (every role but a monitor; a
// monitor reaches reads only). ONE NAME, ONE TAG: a name already on the app-wide list, any case and spaces folded,
// answers that tag — whatever its type — and never makes a twin (createTag).
func (s *Service) RestockTagCreate(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockTagCreateRequest],
) (*connect.Response[inventoryv1.RestockTagCreateResponse], error) {
	tag, created, err := s.createTag(ctx, req.Msg.GetName(), tagTypeCustom)
	if err != nil {
		return nil, tagErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockTagCreateResponse{Tag: tag, Created: created}), nil
}
