package user_v1

import (
	"context"
	"database/sql"
	"strings"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// SearchUser implements [userv1connect.UserServiceHandler].
//
// The Add Member popup's search (a-member-is-found-in-a-search-popup), and Create Team's Owner picker at team 0.
// The interceptor has proved the caller manages members in `team_id` (only-member-managers-open-the-search).
//
//   - An Owner or an Admin finds a person by their WHOLE username, email or phone
//     (managers-search-by-exact-username-phone-or-email): someone they already know, never a browse of other
//     teams' people. A phone compares however it is written — `user_phone_key`, migration 00007.
//   - Root and the Administrator match any part of a name or username.
//   - A suspended account is never found (a-suspended-user-is-never-picked); an erased one is suspended too.
//
// Each result carries the last four digits of its phone (a-result-shows-the-phones-last-four-digits), and the
// answer says who already holds a role in the team (an-existing-member-gets-change-role).
func (s *Service) SearchUser(
	ctx context.Context,
	req *connect.Request[userv1.SearchUserRequest],
) (*connect.Response[userv1.SearchUserResponse], error) {
	teamID := req.Msg.GetTeamId()

	scope := teamID
	if scope == 0 {
		scope = san_auth.RootTeamID
	}

	caller, err := s.callerIn(ctx, scope)
	if err != nil {
		return nil, err
	}

	q := strings.TrimSpace(req.Msg.GetQ())

	limit := int(req.Msg.GetLimit())
	if limit == 0 {
		limit = 10
	}

	query := s.db.
		WithContext(ctx).
		Model(&user_service_models.User{}).
		Where("NOT is_suspended")

	if caller.isRoot() || caller.isAdministrator() {
		pattern := "%" + escapeLike(q) + "%"
		query = query.Where("(username ILIKE ? OR name ILIKE ?)", pattern, pattern)
	} else {
		// Each arm repeats its index's own predicate (`email <> ''`, `phone_number <> ''`), so all three are
		// index lookups. A term with no digits has no phone key and matches no phone.
		query = query.Where(
			"(LOWER(username) = LOWER(@q)"+
				" OR (email <> '' AND LOWER(email) = LOWER(@q))"+
				" OR (phone_number <> '' AND user_phone_key(@q) <> '' AND user_phone_key(phone_number) = user_phone_key(@q)))",
			sql.Named("q", q),
		)
	}

	var users []user_service_models.User

	err = query.
		Order("id ASC").
		Limit(limit).
		Find(&users).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	out := make([]*userv1.PublicUser, 0, len(users))
	ids := make([]uint64, 0, len(users))

	for i := range users {
		found := publicUserToProto(&users[i])
		found.PhoneLast4 = phoneLast4(users[i].PhoneNumber)

		out = append(out, found)
		ids = append(ids, users[i].ID)
	}

	roles, err := s.rolesIn(ctx, teamID, ids)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&userv1.SearchUserResponse{Users: out, RolesInTeam: roles}), nil
}

// rolesIn is each of `userIDs`' role in the team, for those who hold one. Nothing at team 0: the root team is
// not one a person is added to from the popup.
func (s *Service) rolesIn(ctx context.Context, teamID uint64, userIDs []uint64) (map[uint64]role_basev1.Role, error) {
	roles := map[uint64]role_basev1.Role{}

	if teamID == 0 || len(userIDs) == 0 {
		return roles, nil
	}

	var rows []user_service_models.UserTeamRole

	err := s.db.
		WithContext(ctx).
		Where("team_id = ? AND user_id IN ?", teamID, userIDs).
		Find(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	for _, row := range rows {
		roles[row.UserID] = role_basev1.Role(row.Role)
	}

	return roles, nil
}

// phoneLast4 is what tells two people with one name apart without showing either number. Nothing when the
// number has four digits or fewer: then the last four would be all of it.
func phoneLast4(phone string) string {
	var digits strings.Builder

	for _, r := range phone {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
		}
	}

	d := digits.String()
	if len(d) <= 4 {
		return ""
	}

	return d[len(d)-4:]
}
