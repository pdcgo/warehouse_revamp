package user_v1

import (
	"context"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"

	"connectrpc.com/connect"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// Shared helpers used by more than one RPC handler in this package. RPC-specific helpers stay
// beside their handler; only the broadly-shared ones live here.

var errUserMissing = errors.New("user not found")

// rootUserID is the account seeded with ROLE_ROOT in the root team.
const rootUserID uint64 = 1

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

// applyUserUpdates updates a user's row and returns the fresh record. Existence is checked
// first, not inferred from RowsAffected — Postgres reports 0 rows affected when an UPDATE writes
// identical values, so re-submitting an unchanged form would otherwise return a spurious
// NotFound.
func (s *Service) applyUserUpdates(ctx context.Context, userID uint64, updates map[string]any) (*user_service_models.User, error) {
	var user user_service_models.User

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var count int64

		err := tx.Model(&user_service_models.User{}).Where("id = ?", userID).Count(&count).Error
		if err != nil {
			return err
		}

		if count == 0 {
			return errUserMissing
		}

		if len(updates) > 0 {
			updates["updated_at"] = gorm.Expr("NOW()")

			// Only a live account: an erased one is never edited (an-erased-account-is-final). The condition is in
			// the UPDATE itself, so an erase that commits while this waits for the row is seen, not overwritten.
			res := tx.
				Model(&user_service_models.User{}).
				Where("id = ? AND erased_at IS NULL", userID).
				Updates(updates)
			if res.Error != nil {
				return res.Error
			}

			if res.RowsAffected == 0 {
				return errErased("is never edited")
			}
		}

		return tx.Where("id = ?", userID).First(&user).Error
	})
	if err != nil {
		if errors.Is(err, errUserMissing) {
			return nil, connect.NewError(connect.CodeNotFound, errUserMissing)
		}

		var connectErr *connect.Error
		if errors.As(err, &connectErr) {
			return nil, connectErr
		}

		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return nil, connect.NewError(connect.CodeAlreadyExists, errors.New("username or email already in use"))
		}

		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return &user, nil
}

// escapeLike neutralises the LIKE wildcards. Not an injection fix (the value is bound), but
// without it a search for "%" matches every user and "_" matches any character.
func escapeLike(q string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
}

// publicUserToProto is the shape any authenticated caller may see: id, username, name, photo, and
// whether the account is suspended — a "who" filter badges that (a-filter-keeps-former-and-suspended-people).
//
// NO email, NO phone. The source returned the full record from its bulk/search RPCs under a
// mere allow_only_authenticated policy, so any logged-in user could harvest every colleague's
// contact details. A picker needs a name. (SearchUser adds the phone's last four digits itself.)
func publicUserToProto(user *user_service_models.User) *userv1.PublicUser {
	return &userv1.PublicUser{
		Id:          user.ID,
		Username:    user.Username,
		Name:        user.Name,
		AvatarUrl:   user.AvatarURL,
		IsSuspended: user.IsSuspended,
	}
}

func totalPages(total int64, limit uint32) uint32 {
	if limit == 0 {
		return 0
	}

	return uint32(math.Ceil(float64(total) / float64(limit)))
}

// writePassword hashes and stores a new password, stamps last_password_reset (which kills every
// token minted before `now` — see CheckAccess), and drops the user's cached roles.
//
// Shared by every path that sets a password: the authenticated self-serve reset (which also
// mints a token, on top of this) and the OTP forgot-password reset (which does not).
func writePassword(
	ctx context.Context,
	db *gorm.DB,
	resolver access_interceptors.RoleResolver,
	userID uint64,
	password string,
	now time.Time,
) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	res := db.
		WithContext(ctx).
		Model(&user_service_models.User{}).
		Where("id = ? AND erased_at IS NULL", userID).
		Updates(map[string]any{
			"password":            string(hash),
			"last_password_reset": now,
			"updated_at":          gorm.Expr("NOW()"),
		})
	if res.Error != nil {
		return res.Error
	}

	// The account was found by the caller, so no row means it is erased — and stays without a password.
	if res.RowsAffected == 0 {
		return errErased("is never given a password")
	}

	// A password change is a security event — drop cached roles so nothing stale survives it.
	_ = resolver.Invalidate(ctx, userID)

	return nil
}

// errErased refuses an act on an erased account (an-erased-account-is-final), saying which.
func errErased(what string) error {
	return connect.NewError(connect.CodeFailedPrecondition,
		fmt.Errorf("an erased account %s (an-erased-account-is-final)", what))
}

// reservedUsername: `erased` and digits names an erased account and nothing else (erased-usernames-are-reserved), so
// erasing user 57 can never collide with somebody already called erased57.
var reservedUsernamePattern = regexp.MustCompile(`^erased[0-9]+$`)

func refuseReservedUsername(username string) error {
	if reservedUsernamePattern.MatchString(username) {
		return connect.NewError(connect.CodeInvalidArgument,
			errors.New("a username of erased and digits is kept for erased accounts (erased-usernames-are-reserved)"))
	}

	return nil
}
