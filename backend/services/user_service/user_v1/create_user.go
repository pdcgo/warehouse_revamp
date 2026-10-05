package user_v1

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// CreateUser implements [userv1connect.UserServiceHandler].
//
// Scoped, and the scope does double duty (see the proto):
//
//	team_id > 0  -> create the user AND add them to that team. A team owner/admin may do this
//	                for their OWN team; the interceptor already proved they hold a role in it.
//	team_id = 0  -> create a teamless user. An unset scope resolves to the root team, so this
//	                path is automatically root/admin-only.
//
// Both tables are ours, so the user and the membership are written in ONE transaction. No saga,
// no compensation, no window in which a user exists with no team.
func (s *Service) CreateUser(
	ctx context.Context,
	req *connect.Request[userv1.CreateUserRequest],
) (*connect.Response[userv1.CreateUserResponse], error) {
	teamID := req.Msg.GetTeamId()
	role := req.Msg.GetRole()

	if teamID > 0 && role == role_basev1.Role_ROLE_UNSPECIFIED {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("a role is required when creating a user inside a team"))
	}

	// The role is a GRANT, so it passes the same rules as Add Member: never Root, the Administrator
	// only by Root, only a role below the caller's own, and only a role of this team's type — which
	// also covers the old "Root and the Administrator only in the root team" check. A new person holds
	// no role yet, so `current` is none.
	if teamID > 0 {
		caller, err := s.callerIn(ctx, teamID)
		if err != nil {
			return nil, err
		}

		teamType, err := s.teamTypeOf(ctx, teamID)
		if err != nil {
			return nil, err
		}

		err = checkMemberWrite(caller, memberWrite{teamType: teamType, next: role})
		if err != nil {
			return nil, err
		}
	}

	// Normalise before writing: the unique indexes are on LOWER(username) / LOWER(email), so
	// storing mixed case would let "Root" and "root" both look inserted-and-fine right up until
	// login could not tell them apart.
	username := strings.ToLower(strings.TrimSpace(req.Msg.GetUsername()))
	email := strings.ToLower(strings.TrimSpace(req.Msg.GetEmail()))

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Msg.GetPassword()), bcrypt.DefaultCost)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	user := user_service_models.User{
		Username:    username,
		Email:       email,
		Name:        req.Msg.GetName(),
		PhoneNumber: req.Msg.GetPhoneNumber(),
		Password:    string(hash),
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Create(&user).Error
		if err != nil {
			return err
		}

		if teamID == 0 {
			return nil
		}

		return tx.Create(&user_service_models.UserTeamRole{
			TeamID: teamID,
			UserID: user.ID,
			Role:   int32(role),
			Alias:  req.Msg.GetAlias(),
		}).Error
	})
	if err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return nil, connect.NewError(connect.CodeAlreadyExists,
				errors.New("username or email already exists"))
		}

		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&userv1.CreateUserResponse{User: userToProto(&user)}), nil
}

// userToProto never includes the password hash. Obvious, and worth being deliberate about: a
// single careless field here leaks every hash in the system through a list endpoint.
func userToProto(user *user_service_models.User) *userv1.User {
	return &userv1.User{
		Id:          user.ID,
		Username:    user.Username,
		Name:        user.Name,
		Email:       user.Email,
		PhoneNumber: user.PhoneNumber,
		IsSuspended: user.IsSuspended,
		AvatarUrl:   user.AvatarURL,
	}
}
