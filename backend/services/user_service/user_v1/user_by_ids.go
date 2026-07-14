package user_v1

import (
	"context"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// UserByIDs implements [userv1connect.UserServiceHandler] — turn ids into names.
//
// Unknown ids are OMITTED from the map: check for presence, never index blindly.
func (s *Service) UserByIDs(
	ctx context.Context,
	req *connect.Request[userv1.UserByIDsRequest],
) (*connect.Response[userv1.UserByIDsResponse], error) {
	var users []user_service_models.User

	err := s.db.
		WithContext(ctx).
		Where("id IN ?", req.Msg.GetIds()).
		Find(&users).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Never nil: ranging an empty result must be safe for every caller.
	data := make(map[uint64]*userv1.PublicUser, len(users))
	for i := range users {
		data[users[i].ID] = publicUserToProto(&users[i])
	}

	return connect.NewResponse(&userv1.UserByIDsResponse{Data: data}), nil
}
