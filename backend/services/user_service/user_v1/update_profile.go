package user_v1

import (
	"context"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// UpdateProfile implements [userv1connect.UserServiceHandler] — the caller edits THEIR OWN
// details. No user_id, same rule as ResetPassword: the subject is the token holder.
func (s *Service) UpdateProfile(
	ctx context.Context,
	req *connect.Request[userv1.UpdateProfileRequest],
) (*connect.Response[userv1.UpdateProfileResponse], error) {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, err)
	}

	updates := profileUpdates(req.Msg.Name, req.Msg.Email, req.Msg.PhoneNumber)

	// The avatar URL comes from document_service after the client uploads a profile picture.
	if req.Msg.AvatarUrl != nil {
		updates["avatar_url"] = req.Msg.GetAvatarUrl()
	}

	user, err := s.applyUserUpdates(ctx, identity.GetIdentityId(), updates)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&userv1.UpdateProfileResponse{User: userToProto(user)}), nil
}
