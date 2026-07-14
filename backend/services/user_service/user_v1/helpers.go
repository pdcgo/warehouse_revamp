package user_v1

import (
	"context"
	"errors"
	"math"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
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

func totalPages(total int64, limit uint32) uint32 {
	if limit == 0 {
		return 0
	}

	return uint32(math.Ceil(float64(total) / float64(limit)))
}
