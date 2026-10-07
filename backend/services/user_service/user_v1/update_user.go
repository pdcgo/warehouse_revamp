package user_v1

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
)

// UpdateUser implements [userv1connect.UserServiceHandler] — root/admin edits ANOTHER user.
//
// The username is editable (the-username-is-editable): a typo is fixed in place, so the account keeps
// its id and every record it made. The contract holds it to the create rule (lowercase letters and
// digits), the unique index to one account per name, and user 1 keeps `root`
// (dev-root-password-is-root1234 — the development login is written down by that name).
func (s *Service) UpdateUser(
	ctx context.Context,
	req *connect.Request[userv1.UpdateUserRequest],
) (*connect.Response[userv1.UpdateUserResponse], error) {
	userID := req.Msg.GetUserId()
	updates, err := profileUpdates(req.Msg.Name, req.Msg.Email, req.Msg.PhoneNumber)
	if err != nil {
		return nil, err
	}

	if req.Msg.Username != nil {
		// Stored normalised, as at create: the unique index is on LOWER(username).
		username := strings.ToLower(strings.TrimSpace(req.Msg.GetUsername()))

		if userID == rootUserID && username != "root" {
			return nil, connect.NewError(connect.CodeFailedPrecondition,
				errors.New("user 1 keeps the username root (the-username-is-editable)"))
		}

		err = refuseReservedUsername(username)
		if err != nil {
			return nil, err
		}

		updates["username"] = username
	}

	user, err := s.applyUserUpdates(ctx, userID, updates)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&userv1.UpdateUserResponse{User: userToProto(user)}), nil
}
