package user_v1

import (
	"context"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
)

// UpdateUser implements [userv1connect.UserServiceHandler] — root/admin edits ANOTHER user.
func (s *Service) UpdateUser(
	ctx context.Context,
	req *connect.Request[userv1.UpdateUserRequest],
) (*connect.Response[userv1.UpdateUserResponse], error) {
	updates := profileUpdates(req.Msg.Name, req.Msg.Email, req.Msg.PhoneNumber)

	user, err := s.applyUserUpdates(ctx, req.Msg.GetUserId(), updates)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&userv1.UpdateUserResponse{User: userToProto(user)}), nil
}
