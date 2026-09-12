package selling_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ShopUserRemove revokes a user's access to a shop. Removing an access that isn't there is a no-op
// success. The shop must belong to the scoped team.
func (s *Service) ShopUserRemove(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopUserRemoveRequest],
) (*connect.Response[sellingv1.ShopUserRemoveResponse], error) {
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
			Where("shop_id = ? AND user_id = ?", shopID, userID).
			Delete(&selling_service_models.ShopUser{}).
			Error
	})
	if err != nil {
		if errors.Is(err, errShopMissing) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&sellingv1.ShopUserRemoveResponse{}), nil
}
