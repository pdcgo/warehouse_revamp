package user_v1

import (
	"context"
	"math"
	"strings"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// escapeLike neutralises the LIKE wildcards. Not an injection fix (the value is bound), but
// without it a search for "%" matches every user and "_" matches any character.
func escapeLike(q string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
}

// publicUserToProto is the shape any authenticated caller may see: id, username, name.
//
// NO email, NO phone. The source returned the full record from its bulk/search RPCs under a
// mere allow_only_authenticated policy, so any logged-in user could harvest every colleague's
// contact details. A picker needs a name.
func publicUserToProto(user *user_service_models.User) *userv1.PublicUser {
	return &userv1.PublicUser{
		Id:       user.ID,
		Username: user.Username,
		Name:     user.Name,
	}
}

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

func totalPages(total int64, limit uint32) uint32 {
	if limit == 0 {
		return 0
	}

	return uint32(math.Ceil(float64(total) / float64(limit)))
}

// UserByIDs implements [userv1connect.UserServiceHandler] — turn ids into names.
//
// Unknown ids are OMITTED from the map: check for presence, never index blindly.
func (s *Service) UserByIDs(
	ctx context.Context,
	req *connect.Request[userv1.UserByIDsRequest],
) (*connect.Response[userv1.UserByIDsResponse], error) {
	var users []user_service_models.User

	err := s.db.
		WithContext(ctx).
		Where("id IN ?", req.Msg.GetIds()).
		Find(&users).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Never nil: ranging an empty result must be safe for every caller.
	data := make(map[uint64]*userv1.PublicUser, len(users))
	for i := range users {
		data[users[i].ID] = publicUserToProto(&users[i])
	}

	return connect.NewResponse(&userv1.UserByIDsResponse{Data: data}), nil
}

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
