package user_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// TeamAccessList implements [userv1connect.UserServiceHandler].
//
// The session bootstrap: which teams am I in, and as what. It is what the frontend calls right
// after login, and it is where the source's cross-service JOIN lived.
//
// Two things it does NOT do:
//
//   - It does not JOIN `teams`. That table belongs to team_service. Memberships come from our
//     own table; names are resolved over RPC (teamResolver).
//   - It does not fail when team_service is down. It degrades: ids and roles are still correct,
//     only the display name goes blank. A name lookup must never be able to break login.
func (s *Service) TeamAccessList(
	ctx context.Context,
	req *connect.Request[userv1.TeamAccessListRequest],
) (*connect.Response[userv1.TeamAccessListResponse], error) {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, err)
	}

	caller := identity.GetIdentityId()

	// IDOR GUARD. user_id = 0 means "me". Naming SOMEONE ELSE requires root/admin.
	//
	// The source honoured any user_id from any authenticated caller, so any logged-in user could
	// enumerate anyone else's teams and roles. The subject of an identity operation is the token
	// holder, never a request field.
	target := req.Msg.GetUserId()
	if target == 0 {
		target = caller
	}

	if target != caller {
		access, err := s.resolver.Resolve(ctx, caller, san_auth.RootTeamID)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		if access.RootRole != role_basev1.Role_ROLE_ROOT && access.RootRole != role_basev1.Role_ROLE_ADMIN {
			return nil, connect.NewError(connect.CodePermissionDenied,
				errors.New("listing another user's teams requires root or admin"))
		}
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

	// Never errors — degrades to an empty map if team_service is unreachable.
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
			item.ImageUrl = team.ImageURL
		}

		items = append(items, item)
	}

	return connect.NewResponse(&userv1.TeamAccessListResponse{
		Teams: items,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
