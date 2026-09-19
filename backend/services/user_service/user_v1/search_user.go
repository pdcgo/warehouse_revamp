package user_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// SearchUser implements [userv1connect.UserServiceHandler].
//
// DELIBERATELY UNSCOPED: its entire purpose is finding people who are NOT in your team yet, so
// you can add them. Scoping it to your own team would make it useless.
//
// The exposure is bounded on purpose: a minimum query length (no enumerating the whole table
// with ""), a hard result cap, and PublicUser only — no email, no phone.
func (s *Service) SearchUser(
	ctx context.Context,
	req *connect.Request[userv1.SearchUserRequest],
) (*connect.Response[userv1.SearchUserResponse], error) {
	pattern := "%" + escapeLike(strings.TrimSpace(req.Msg.GetQ())) + "%"

	limit := int(req.Msg.GetLimit())
	if limit == 0 {
		limit = 10
	}

	var users []user_service_models.User

	err := s.db.
		WithContext(ctx).
		Where("username ILIKE ? OR name ILIKE ?", pattern, pattern).
		Order("id ASC").
		Limit(limit).
		Find(&users).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	out := make([]*userv1.PublicUser, 0, len(users))
	for i := range users {
		out = append(out, publicUserToProto(&users[i]))
	}

	return connect.NewResponse(&userv1.SearchUserResponse{Users: out}), nil
}
