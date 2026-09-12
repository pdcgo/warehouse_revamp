package selling_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ShopUpdate edits a shop in the scoped team. Absent fields are left alone. The team_id clause
// scopes the write — a shop in another team reads as NotFound.
func (s *Service) ShopUpdate(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopUpdateRequest],
) (*connect.Response[sellingv1.ShopUpdateResponse], error) {
	teamID := req.Msg.GetTeamId()
	shopID := req.Msg.GetShopId()

	updates := map[string]any{}

	if req.Msg.Name != nil {
		updates["name"] = req.Msg.GetName()
	}

	if req.Msg.ShopCode != nil {
		updates["shop_code"] = req.Msg.GetShopCode()
	}

	if req.Msg.Marketplace != nil {
		updates["marketplace"] = san_marketplace.ToText(req.Msg.GetMarketplace())
	}

	if req.Msg.Description != nil {
		updates["description"] = req.Msg.GetDescription()
	}

	var shop selling_service_models.Shop

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Check existence FIRST — Postgres reports 0 rows affected when an UPDATE writes identical
		// values, so inferring NotFound from RowsAffected would misfire on a no-op resubmit.
		exists, err := shopExists(tx, teamID, shopID)
		if err != nil {
			return err
		}

		if !exists {
			return errShopMissing
		}

		if len(updates) > 0 {
			err = tx.
				Model(&selling_service_models.Shop{}).
				Where("id = ? AND team_id = ?", shopID, teamID).
				Updates(withUpdatedAt(updates)).
				Error
			if err != nil {
				return err
			}
		}

		return tx.Where("id = ? AND team_id = ?", shopID, teamID).First(&shop).Error
	})
	if err != nil {
		if errors.Is(err, errShopMissing) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&sellingv1.ShopUpdateResponse{Shop: toProto(&shop)}), nil
}
