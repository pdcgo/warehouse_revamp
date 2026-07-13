package user_service

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

var errUserMissing = errors.New("user not found")

// profileUpdates builds the SET map from PRESENT fields only. Absent means leave alone —
// without presence there is no way to say "don't touch this", and a name-only edit silently
// blanks the email.
func profileUpdates(name, email, phone *string) map[string]any {
	updates := map[string]any{}

	if name != nil {
		updates["name"] = *name
	}

	if email != nil {
		// The unique index is on LOWER(email): store it normalised or two rows can differ only
		// by case and neither the index nor login can tell them apart.
		updates["email"] = strings.ToLower(strings.TrimSpace(*email))
	}

	if phone != nil {
		updates["phone_number"] = *phone
	}

	return updates
}

func (s *Service) applyUserUpdates(ctx context.Context, userID uint64, updates map[string]any) (*user_service_models.User, error) {
	var user user_service_models.User

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var count int64

		// Check existence FIRST rather than inferring it from RowsAffected: Postgres reports 0
		// rows affected when an UPDATE writes identical values, so re-submitting an unchanged
		// form would otherwise return a spurious NotFound.
		err := tx.Model(&user_service_models.User{}).Where("id = ?", userID).Count(&count).Error
		if err != nil {
			return err
		}

		if count == 0 {
			return errUserMissing
		}

		if len(updates) > 0 {
			updates["updated_at"] = gorm.Expr("NOW()")

			err = tx.
				Model(&user_service_models.User{}).
				Where("id = ?", userID).
				Updates(updates).
				Error
			if err != nil {
				return err
			}
		}

		return tx.Where("id = ?", userID).First(&user).Error
	})
	if err != nil {
		if errors.Is(err, errUserMissing) {
			return nil, connect.NewError(connect.CodeNotFound, errUserMissing)
		}

		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("email already in use"))
		}

		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return &user, nil
}

// UpdateProfile implements [userv1connect.UserServiceHandler] — the caller edits THEIR OWN
// details. No user_id, same rule as ResetPassword: the subject is the token holder.
func (s *Service) UpdateProfile(
	ctx context.Context,
	req *connect.Request[userv1.UpdateProfileRequest],
) (*connect.Response[userv1.UpdateProfileResponse], error) {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, err)
	}

	updates := profileUpdates(req.Msg.Name, req.Msg.Email, req.Msg.PhoneNumber)

	user, err := s.applyUserUpdates(ctx, identity.GetIdentityId(), updates)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&userv1.UpdateProfileResponse{User: userToProto(user)}), nil
}

// UpdateUser implements [userv1connect.UserServiceHandler] — root/admin edits ANOTHER user.
func (s *Service) UpdateUser(
	ctx context.Context,
	req *connect.Request[userv1.UpdateUserRequest],
) (*connect.Response[userv1.UpdateUserResponse], error) {
	updates := profileUpdates(req.Msg.Name, req.Msg.Email, req.Msg.PhoneNumber)

	user, err := s.applyUserUpdates(ctx, req.Msg.GetUserId(), updates)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&userv1.UpdateUserResponse{User: userToProto(user)}), nil
}

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

// rootUserID is the account seeded with ROLE_ROOT in the root team.
const rootUserID uint64 = 1

// DeleteUser implements [userv1connect.UserServiceHandler]. Hard delete; memberships cascade.
func (s *Service) DeleteUser(
	ctx context.Context,
	req *connect.Request[userv1.DeleteUserRequest],
) (*connect.Response[userv1.DeleteUserResponse], error) {
	userID := req.Msg.GetUserId()

	if userID == rootUserID {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("the root account cannot be deleted"))
	}

	result := s.db.
		WithContext(ctx).
		Where("id = ?", userID).
		Delete(&user_service_models.User{})
	if result.Error != nil {
		return nil, connect.NewError(connect.CodeInternal, result.Error)
	}

	if result.RowsAffected == 0 {
		return nil, connect.NewError(connect.CodeNotFound, errUserMissing)
	}

	// The FK on user_team_roles is ON DELETE CASCADE, so the memberships are already gone. The
	// CACHE is not — and a cached role for a deleted user would keep authorizing requests until
	// it expired.
	err := s.resolver.Invalidate(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&userv1.DeleteUserResponse{}), nil
}
