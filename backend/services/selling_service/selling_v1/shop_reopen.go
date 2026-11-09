package selling_v1

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// errCodeHeldOnReopen is a reopen whose code an OPEN shop of the team already holds
// (a-shop-code-is-unique-among-open-shops) — found by the partial unique index when no holder could be named first
// (one took the code in the same instant).
var errCodeHeldOnReopen = errors.New("an open shop of the team holds this shop's code — rename one, then reopen")

// ShopReopen gives a closed shop of the scoped team back its selling (a-shop-is-closed-never-deleted): `status = open`,
// `closed_at` cleared. Its waiting drafts can be finalized again (a-close-leaves-the-drafts-waiting).
//
//   - REFUSED while an OPEN shop of the team holds its code — FailedPrecondition, naming that shop
//     (a-shop-code-is-unique-among-open-shops): closing freed the code, and a new shop may have taken it. Rename one,
//     then reopen. A holder that lands in the same instant is caught by the partial unique index and refused the same
//     way, by the code.
//   - IDEMPOTENT: an open shop is answered as it is.
//
// The row is locked FOR NO KEY UPDATE first (lockShopRow), as ShopClose and ShopUpdate lock it. Another team's shop is
// NotFound.
func (s *Service) ShopReopen(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopReopenRequest],
) (*connect.Response[sellingv1.ShopReopenResponse], error) {
	teamID := req.Msg.GetTeamId()
	shopID := req.Msg.GetShopId()

	var (
		shop   *selling_service_models.Shop
		holder *selling_service_models.Shop
	)

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var lockErr error

		shop, lockErr = lockShopRow(tx, teamID, shopID)
		if lockErr != nil {
			return lockErr
		}

		if !shop.IsClosed() {
			return nil
		}

		// WHO HOLDS THE CODE NOW — an open shop of the team, never this one (it is closed). Named in the refusal so the
		// person knows which to rename.
		var holders []selling_service_models.Shop

		findErr := tx.
			Select("id", "name", "shop_code").
			Where("team_id = ? AND shop_code = ? AND status = ? AND id <> ?",
				teamID, shop.ShopCode, selling_service_models.ShopOpen, shopID).
			Limit(1).
			Find(&holders).
			Error
		if findErr != nil {
			return findErr
		}

		if len(holders) > 0 {
			holder = &holders[0]

			return errCodeHeldOnReopen
		}

		now := time.Now()

		updateErr := tx.
			Model(&selling_service_models.Shop{}).
			Where("id = ? AND team_id = ?", shopID, teamID).
			Updates(map[string]any{
				"status":     selling_service_models.ShopOpen,
				"closed_at":  nil,
				"updated_at": now,
			}).
			Error
		if updateErr != nil {
			if errors.Is(updateErr, gorm.ErrDuplicatedKey) {
				return errCodeHeldOnReopen
			}

			return updateErr
		}

		shop.Status = selling_service_models.ShopOpen
		shop.ClosedAt = nil
		shop.UpdatedAt = now

		return nil
	})
	if err != nil {
		switch {
		case errors.Is(err, errShopMissing):
			return nil, notFound()
		case errors.Is(err, errCodeHeldOnReopen):
			return nil, reopenCodeHeld(shop, holder)
		}

		return nil, dbError(err)
	}

	out, err := s.shopWithPrimary(ctx, shop)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&sellingv1.ShopReopenResponse{Shop: out}), nil
}

// reopenCodeHeld is the refusal in the person's words: the code, and the open shop holding it when it is known.
func reopenCodeHeld(shop, holder *selling_service_models.Shop) error {
	if holder != nil {
		return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf(
			"%s cannot reopen: the open shop %s holds the code %s — rename one, then reopen",
			shop.Name, holder.Name, shop.ShopCode))
	}

	return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf(
		"%s cannot reopen: an open shop of the team holds the code %s — rename one, then reopen",
		shop.Name, shop.ShopCode))
}
