package user_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
)

// SuspendUser implements [userv1connect.UserServiceHandler].
//
// Suspension takes effect on the NEXT REQUEST, not at the next login: the access interceptor
// reads it on every call, and invalidating the cache here makes it immediate. Without that, a
// suspended user would keep working until their token expired.
func (s *Service) SuspendUser(
	ctx context.Context,
	req *connect.Request[userv1.SuspendUserRequest],
) (*connect.Response[userv1.SuspendUserResponse], error) {
	userID := req.Msg.GetUserId()

	// Suspending root would lock the system's only guaranteed super-admin out of itself, and
	// only a super-admin could undo it. Refuse.
	if userID == rootUserID {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("the root account cannot be suspended"))
	}

	_, err := s.applyUserUpdates(ctx, userID, map[string]any{
		"is_suspended": req.Msg.GetSuspended(),
	})
	if err != nil {
		return nil, err
	}

	// Make it bite NOW. The cached access decision says "not suspended".
	err = s.resolver.Invalidate(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&userv1.SuspendUserResponse{}), nil
}
