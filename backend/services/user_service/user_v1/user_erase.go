package user_v1

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	documentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/document/v1"
	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// UserErase implements [userv1connect.UserServiceHandler].
//
// erase-keeps-the-row: a FORMER user's personal data is blanked on request, and the row and its id stay, so every
// record they made still has someone behind it. Only an account already suspended, and only by those who may
// suspend it — nobody themselves, a Root never, an Administrator only by Root. There is no undo.
//
// Blanked: the name, email, phone and photo. The password is cleared — an empty hash never matches, so the account
// can never sign in again — and last_password_reset is stamped, which kills any token it still holds. The username
// becomes erased<id>, so the old one is free for somebody else. Memberships stay: a former member is still the
// person behind that team's history.
func (s *Service) UserErase(
	ctx context.Context,
	req *connect.Request[userv1.UserEraseRequest],
) (*connect.Response[userv1.UserEraseResponse], error) {
	userID := req.Msg.GetUserId()

	caller, err := s.callerIn(ctx, san_auth.RootTeamID)
	if err != nil {
		return nil, err
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// The lock SuspendUser takes: an unsuspend racing the erase queues behind it, and the suspension
		// read here is the one in force when the data is blanked.
		target, err := lockMembership(tx, userID, san_auth.RootTeamID)
		if err != nil {
			return err
		}

		err = checkSuspend(caller, userID, target.role)
		if err != nil {
			return err
		}

		// Already erased: nothing left to blank. Erasing again is not an error — it is how a failed photo
		// deletion is retried (erase-deletes-the-photo-file), after the transaction.
		if target.erased {
			return nil
		}

		if !target.suspended {
			return connect.NewError(connect.CodeFailedPrecondition,
				errors.New("only a suspended account is erased — suspend it first (erase-keeps-the-row)"))
		}

		now := time.Now()

		err = tx.
			Model(&user_service_models.User{}).
			Where("id = ?", userID).
			Updates(map[string]any{
				"username":            erasedUsername(userID),
				"name":                "",
				"email":               "",
				"phone_number":        "",
				"avatar_url":          "",
				"password":            "",
				"last_password_reset": now,
				"erased_at":           now,
				"updated_at":          now,
			}).
			Error
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return connect.NewError(connect.CodeAlreadyExists,
				fmt.Errorf("another account already holds the username %s — rename it, then erase again", erasedUsername(userID)))
		}

		if err != nil {
			return connect.NewError(connect.CodeInternal, err)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	// A suspended account's access was already refused; evicting makes nothing about it linger in the cache.
	err = s.resolver.Invalidate(ctx, userID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// erase-deletes-the-photo-file — AFTER the commit, never inside it: a network call must not hold the row lock.
	// If it fails the account is erased all the same, and erasing it again comes straight here.
	_, err = s.documents.ProfilePictureErase(ctx, connect.NewRequest(&documentv1.ProfilePictureEraseRequest{UserId: userID}))
	if err != nil {
		return nil, connect.NewError(connect.CodeOf(err),
			fmt.Errorf("the account is erased, but deleting its photos failed — erase it again to retry: %s", errorMessage(err)))
	}

	return connect.NewResponse(&userv1.UserEraseResponse{}), nil
}

// erasedUsername is what an erased account is called: unique by its id, and still a valid username.
func erasedUsername(userID uint64) string {
	return fmt.Sprintf("erased%d", userID)
}

// errorMessage is an error's own message, without connect's "code: " prefix — the code travels separately.
func errorMessage(err error) string {
	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		return connectErr.Message()
	}

	return err.Error()
}
