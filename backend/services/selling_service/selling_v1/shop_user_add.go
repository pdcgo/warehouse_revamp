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
func (s *Service) ShopUserAdd(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopUserAddRequest],
) (*connect.Response[sellingv1.ShopUserAddResponse], error) {
	teamID := req.Msg.GetTeamId()
	shopID := req.Msg.GetShopId()
	userID := req.Msg.GetUserId()

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		exists, err := shopExists(tx, teamID, shopID)
		if err != nil {
			return err
		}

		if !exists {
			return errShopMissing
		}

		return tx.
			Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "shop_id"}, {Name: "user_id"}}, DoNothing: true}).
			Create(&selling_service_models.ShopUser{ShopID: shopID, UserID: userID}).
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
