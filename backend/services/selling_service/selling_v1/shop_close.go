package selling_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ShopClose closes a shop of the scoped team (a-shop-is-closed-never-deleted): `status = closed`, `closed_at` now.
// There is no delete — a shop made by mistake is closed too.
//
//   - it takes no new selling from here on (a-closed-shop-refuses-only-new-selling): an order, a pushed draft, the order
//     form's picker; its statements, settlement, accounts and expenses keep running
//   - it is NEVER refused for the drafts it has — they stay listed, waiting (a-close-leaves-the-drafts-waiting)
//   - its code is freed: the unique index holds among OPEN shops only (a-shop-code-is-unique-among-open-shops)
//   - IDEMPOTENT: a shop already closed is answered as it is, its close date untouched — a second click, or two managers
//     at once, is one close
//
// The row is locked FOR NO KEY UPDATE first (lockShopRow), so a close and an edit or a reopen of the same shop queue,
// and an order being placed on it — which takes the row FOR SHARE in its own transaction (refuseClosedShopInTx) —
// either commits before the close or reads it closed. Another team's shop is NotFound.
func (s *Service) ShopClose(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopCloseRequest],
) (*connect.Response[sellingv1.ShopCloseResponse], error) {
	teamID := req.Msg.GetTeamId()
	shopID := req.Msg.GetShopId()

	var shop *selling_service_models.Shop

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var lockErr error

		shop, lockErr = lockShopRow(tx, teamID, shopID)
		if lockErr != nil {
			return lockErr
		}

		if shop.IsClosed() {
			return nil
		}

		now := time.Now()

		updateErr := tx.
			Model(&selling_service_models.Shop{}).
			Where("id = ? AND team_id = ?", shopID, teamID).
			Updates(map[string]any{
				"status":     selling_service_models.ShopClosed,
				"closed_at":  now,
				"updated_at": now,
			}).
			Error
		if updateErr != nil {
			return updateErr
		}

		shop.Status = selling_service_models.ShopClosed
		shop.ClosedAt = &now
		shop.UpdatedAt = now

		return nil
	})
	if err != nil {
		if errors.Is(err, errShopMissing) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	out, err := s.shopWithPrimary(ctx, shop)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&sellingv1.ShopCloseResponse{Shop: out}), nil
}
