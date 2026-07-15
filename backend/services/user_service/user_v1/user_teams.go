package user_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// UserTeams implements [userv1connect.UserServiceHandler].
//
// The admin user-detail view: given a user id, who is this and which teams have they joined? It
// is TeamAccessList pointed at ANOTHER user — root/admin only (the policy on the request), no
// "me" default. Same two invariants:
//
//   - It does not JOIN `teams`. That table belongs to team_service. Memberships come from our own
//     `user_team_roles`; names are resolved over RPC (teamResolver).
//   - It does not fail when team_service is down. It degrades: ids and roles are still correct,
//     only the display name/type goes blank.
func (s *Service) UserTeams(
	ctx context.Context,
	req *connect.Request[userv1.UserTeamsRequest],
) (*connect.Response[userv1.UserTeamsResponse], error) {
	target := req.Msg.GetUserId()

	var user user_service_models.User

	err := s.db.
		WithContext(ctx).
		Where("id = ?", target).
		First(&user).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, errUserMissing)
		}

		return nil, connect.NewError(connect.CodeInternal, err)
	}

	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&user_service_models.UserTeamRole{}).
		Where("user_id = ?", target)

	var total int64

	err = query.Count(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var memberships []user_service_models.UserTeamRole

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = query.
		Order("team_id ASC").
		Offset(offset).
		Limit(int(page.GetLimit())).
		Find(&memberships).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	ids := make([]uint64, 0, len(memberships))
	for i := range memberships {
		ids = append(ids, memberships[i].TeamID)
	}

	// Never errors — degrades to an empty map if team_service is unreachable, exactly as
	// TeamAccessList does. A display-name lookup must not fail viewing a user's memberships.
	teams := s.teams.resolve(ctx, san_auth.GetBearer(ctx), ids)

	items := make([]*userv1.TeamAccessItem, 0, len(memberships))

	for i := range memberships {
		membership := memberships[i]

		item := &userv1.TeamAccessItem{
			TeamId: membership.TeamID,
			Role:   role_basev1.Role(membership.Role),
			Alias:  membership.Alias,
		}

		team, found := teams[membership.TeamID]
		if found {
			item.TeamName = team.Name
			item.TeamType = teamv1.TeamType(team.Type)
		}

		items = append(items, item)
	}

	return connect.NewResponse(&userv1.UserTeamsResponse{
		User:  publicUserToProto(&user),
		Teams: items,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
