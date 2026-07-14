package user_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// UserList implements [userv1connect.UserServiceHandler].
//
// Scoped, with the same double duty as CreateUser:
//
//	team_id > 0 -> the members of that team (the interceptor proved the caller has a role in it)
//	team_id = 0 -> every user; an unset scope resolves to the root team, so root/admin only
//
// Returns the FULL user (email, phone) — that is why it is role-gated, unlike SearchUser.
func (s *Service) UserList(
	ctx context.Context,
	req *connect.Request[userv1.UserListRequest],
) (*connect.Response[userv1.UserListResponse], error) {
	page := req.Msg.GetPage()
	teamID := req.Msg.GetTeamId()

	query := s.db.
		WithContext(ctx).
		Model(&user_service_models.User{})

	if teamID > 0 {
		// A join within user_service's OWN tables — both are ours, so this is not a boundary
		// violation.
		query = query.
			Joins("JOIN user_team_roles ON user_team_roles.user_id = users.id").
			Where("user_team_roles.team_id = ?", teamID)
	}

	if q := strings.TrimSpace(req.Msg.GetQ()); q != "" {
		pattern := "%" + escapeLike(q) + "%"
		query = query.Where("users.username ILIKE ? OR users.name ILIKE ? OR users.email ILIKE ?",
			pattern, pattern, pattern)
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var users []user_service_models.User

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = query.
		Order("users.id ASC").
		Offset(offset).
		Limit(int(page.GetLimit())).
		Find(&users).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	out := make([]*userv1.User, 0, len(users))
	for i := range users {
		out = append(out, userToProto(&users[i]))
	}

	return connect.NewResponse(&userv1.UserListResponse{
		Users: out,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
