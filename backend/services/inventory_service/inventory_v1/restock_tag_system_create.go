package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RestockTagSystemCreate makes a SYSTEM tag — Root / the Administrator only (the request's policy;
// custom-tags-are-shared-system-tags-are-the-admins-and-the-apps). The same one-name-one-tag answer as RestockTagCreate:
// a name already taken answers that tag, whatever its type. It has no app task — the app's own tags are seeded by the
// migration, never made here.
func (s *Service) RestockTagSystemCreate(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockTagSystemCreateRequest],
) (*connect.Response[inventoryv1.RestockTagSystemCreateResponse], error) {
	tag, created, err := s.createTag(ctx, req.Msg.GetName(), tagTypeSystem)
	if err != nil {
		return nil, tagErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockTagSystemCreateResponse{Tag: tag, Created: created}), nil
}
