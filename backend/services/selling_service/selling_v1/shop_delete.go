package selling_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ShopDelete soft-deletes a shop in the scoped team (`deleted = true`), which also frees its code
// for reuse. A shop in another team reads as NotFound.
func (s *Service) ShopDelete(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopDeleteRequest],
) (*connect.Response[sellingv1.ShopDeleteResponse], error) {
	teamID := req.Msg.GetTeamId()
	shopID := req.Msg.GetShopId()

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		exists, err := shopExists(tx, teamID, shopID)
		if err != nil {
			return err
		}

		if !exists {
			return errShopMissing
		}

		return tx.
			Model(&selling_service_models.Shop{}).
			Where("id = ? AND team_id = ?", shopID, teamID).
			Updates(withUpdatedAt(map[string]any{"deleted": true})).
			Error
	})
	if err != nil {
		if errors.Is(err, errShopMissing) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&sellingv1.ShopDeleteResponse{}), nil
}
