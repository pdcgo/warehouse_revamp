package selling_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ShopUserAdd grants a user access to a shop. Idempotent — granting an existing access is a no-op
// success (the unique (shop_id, user_id) is upserted). The shop must belong to the scoped team.
//
// A NEW grant on a shop with no primary CS becomes it (the-primary-cs-is-a-flag-on-a-grant) — the first
// user granted, and the next one after the primary's grant was removed. Re-adding an existing grant
// changes nothing, the flag included.
func (s *Service) ShopUserAdd(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopUserAddRequest],
) (*connect.Response[sellingv1.ShopUserAddResponse], error) {
	teamID := req.Msg.GetTeamId()
	shopID := req.Msg.GetShopId()
	userID := req.Msg.GetUserId()

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// The shop's row, FOR UPDATE: two grants landing on a shop with no primary run one after the
		// other, so exactly one of them finds none and becomes it.
		exists, err := lockShop(tx, teamID, shopID)
		if err != nil {
			return err
		}

		if !exists {
			return errShopMissing
		}

		grant := selling_service_models.ShopUser{ShopID: shopID, UserID: userID}

		created := tx.
			Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "shop_id"}, {Name: "user_id"}}, DoNothing: true}).
			Create(&grant)
		if created.Error != nil {
			return created.Error
		}

		if created.RowsAffected == 0 {
			return nil
		}

		return tx.
			Model(&selling_service_models.ShopUser{}).
			Where("id = ? AND NOT EXISTS (SELECT 1 FROM shop_users p WHERE p.shop_id = ? AND p.is_primary)", grant.ID, shopID).
			Update("is_primary", true).
			Error
	})
	if err != nil {
		if errors.Is(err, errShopMissing) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&sellingv1.ShopUserAddResponse{}), nil
}
