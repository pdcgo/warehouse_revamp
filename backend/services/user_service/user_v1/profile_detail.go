package user_v1

import (
	"context"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// ProfileDetail implements [userv1connect.UserServiceHandler] — the caller reads THEIR OWN details, email and phone
// included. No user_id, same rule as UpdateProfile: the subject is the token holder, so the shape cannot ask for
// anyone else's row.
//
// It is what the profile form loads before it edits. Without it the form had only UserByIDs' PublicUser (no email,
// no phone), started those two blank, and a name-only save sent them blank — wiping the phone a password reset goes to.
func (s *Service) ProfileDetail(
	ctx context.Context,
	_ *connect.Request[userv1.ProfileDetailRequest],
) (*connect.Response[userv1.ProfileDetailResponse], error) {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, err)
	}

	var users []user_service_models.User

	err = s.db.
		WithContext(ctx).
		Where("id = ?", identity.GetIdentityId()).
		Limit(1).
		Find(&users).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if len(users) == 0 {
		return nil, connect.NewError(connect.CodeNotFound, errUserMissing)
	}

	return connect.NewResponse(&userv1.ProfileDetailResponse{User: userToProto(&users[0])}), nil
}
