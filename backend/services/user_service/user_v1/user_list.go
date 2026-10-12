package user_v1

import (
	"context"
	"slices"
	"strings"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
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

	if q := strings.TrimSpace(req.Msg.GetFilter().GetQ()); q != "" {
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
		Order(userOrderClause(req.Msg.GetSort())).
		Offset(offset).
		Limit(int(page.GetLimit())).
		Find(&users).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	items, ids := userListItems(users, req.Msg.GetDataRequest())

	if wantsMembership(req.Msg.GetDataRequest()) {
		memberships, err := s.membershipsIn(ctx, membershipTeam(teamID), ids)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		items = append(items, &userv1.UserListResponseItem{
			D: &userv1.UserListResponseItem_Membership{Membership: &userv1.UserMembershipMapItem{MapData: memberships}},
		})
	}

	return connect.NewResponse(&userv1.UserListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}

func wantsMembership(types []userv1.UserListDataType) bool {
	return slices.Contains(types, userv1.UserListDataType_USER_LIST_DATA_TYPE_MEMBERSHIP)
}

// membershipTeam is the team the MEMBERSHIP slice reads roles in: the scoped team, or at team_id = 0 (every
// user) the root team, so the all-users view can tell Root and the Administrator from everyone else.
func membershipTeam(teamID uint64) uint64 {
	if teamID == 0 {
		return san_auth.RootTeamID
	}

	return teamID
}

// membershipsIn is the MEMBERSHIP slice: the role each listed user holds in teamID — ONE query for the page,
// never one per row. A user with no role there is absent from the map, which the screen reads as no role.
//
// The alias is not sent: it is to be dropped (a-user-is-name-username-email-phone-and-photo).
func (s *Service) membershipsIn(ctx context.Context, teamID uint64, userIDs []uint64) (map[uint64]*userv1.UserMembership, error) {
	memberships := make(map[uint64]*userv1.UserMembership, len(userIDs))

	if len(userIDs) == 0 {
		return memberships, nil
	}

	var rows []user_service_models.UserTeamRole

	err := s.db.
		WithContext(ctx).
		Select("user_id", "role").
		Where("team_id = ? AND user_id IN ?", teamID, userIDs).
		Find(&rows).
		Error
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		memberships[row.UserID] = &userv1.UserMembership{Role: role_basev1.Role(row.Role)}
	}

	return memberships, nil
}
