package selling_v1

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// shopAccess is ShopAccessCheck's answer, read in-process: the shop — a deleted (closed) one included, flagged — its
// primary CS, and whether the user may WRITE on it (a-write-needs-a-grant-or-a-manager).
//
// The one definition of who may write on a shop. ShopAccessCheck returns it to other services; the order writes of this
// service ask it directly, with no RPC hop (refuseShopWrite).
//
// Another team's shop, or one that never existed, is NotFound — the scope check. A deleted shop is ANSWERED, and each
// caller decides what a closed shop may still do (a-closed-shop-refuses-only-new-selling).
func (s *Service) shopAccess(
	ctx context.Context,
	teamID, shopID, userID uint64,
) (*selling_service_models.Shop, bool, error) {
	db := s.db.WithContext(ctx)

	var shop selling_service_models.Shop

	err := db.
		Where("id = ? AND team_id = ?", shopID, teamID).
		First(&shop).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, notFound()
		}

		return nil, false, dbError(err)
	}

	// The primary and the user's own grant, in one read — at most two rows.
	var grants []selling_service_models.ShopUser

	err = db.
		Where("shop_id = ? AND (is_primary OR user_id = ?)", shopID, userID).
		Find(&grants).
		Error
	if err != nil {
		return nil, false, dbError(err)
	}

	granted := false

	for _, grant := range grants {
		if grant.IsPrimary {
			shop.PrimaryUserID = grant.UserID
		}

		if userID != 0 && grant.UserID == userID {
			granted = true
		}
	}

	// A grant answers it without asking anyone. Only without one does a manager role matter — and the roles are
	// user_service's, read through its cached resolver.
	if granted {
		return &shop, true, nil
	}

	team, root, err := s.roles.Roles(ctx, userID, teamID)
	if err != nil {
		return nil, false, connect.NewError(connect.CodeInternal, err)
	}

	return &shop, isManager(team, root), nil
}

// errShopClosed is a closed shop refusing new selling (a-closed-shop-refuses-only-new-selling). Until the close is
// built, a closed shop is a deleted one (a-shop-is-closed-never-deleted).
var errShopClosed = errors.New("the shop is closed — it takes no new orders (a-closed-shop-refuses-only-new-selling)")

// refuseShopWrite is the write gate on the shop for NEW SELLING — OrderCreate (a draft's Promote is OrderCreate),
// OrderDraftPush and the shop a draft is set to (a-write-needs-a-grant-or-a-manager). Asked before anything is
// taken or written, so a refusal moves no stock.
//
//   - not this team's shop — NotFound, as before (every-shop-call-is-scoped-to-its-team)
//   - a closed (deleted) shop — FailedPrecondition, naming it (a-closed-shop-refuses-only-new-selling)
//   - no grant and no manager role — PermissionDenied, naming it, in the importer's words
//
// The caller is the request's identity. A call with none holds no grant and no role, so it is refused like any other
// stranger — the interceptor never lets one through, and a handler called directly gets no free pass.
func (s *Service) refuseShopWrite(ctx context.Context, teamID, shopID uint64) error {
	shop, access, err := s.shopAccess(ctx, teamID, shopID, eventActor(ctx))
	if err != nil {
		return err
	}

	if shop.Deleted {
		return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("%s: %w", shop.Name, errShopClosed))
	}

	if !access {
		return connect.NewError(connect.CodePermissionDenied,
			fmt.Errorf("You have no access to %s — ask the team's owner or admin for it", shop.Name))
	}

	return nil
}
