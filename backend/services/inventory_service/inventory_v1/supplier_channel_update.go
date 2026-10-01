package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// SupplierChannelUpdate edits a channel in the scoped team. Absent fields are left alone. The
// online/marketplace pairing is re-checked against the RESULTING row (a patch that would leave an
// online channel without a marketplace is rejected), and the stored marketplace tracks the type — an
// offline channel keeps none. A channel outside the team reads as NotFound.
func (s *Service) SupplierChannelUpdate(
	ctx context.Context,
	req *connect.Request[inventoryv1.SupplierChannelUpdateRequest],
) (*connect.Response[inventoryv1.SupplierChannelUpdateResponse], error) {
	teamID := req.Msg.GetTeamId()
	channelID := req.Msg.GetChannelId()

	var channel inventory_service_models.SupplierChannel

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		existing, loadErr := loadTeamChannel(tx, teamID, channelID)
		if loadErr != nil {
			return loadErr
		}

		// Resolve the RESULTING type and marketplace from the existing row plus the patch.
		finalType := channelTypeFromText(existing.Type)
		if req.Msg.Type != nil {
			finalType = req.Msg.GetType()
		}

		finalMarketplace := san_marketplace.FromText(existing.Marketplace)
		if req.Msg.Marketplace != nil {
			finalMarketplace = req.Msg.GetMarketplace()
		}

		online := finalType == inventoryv1.SupplierChannelType_SUPPLIER_CHANNEL_TYPE_ONLINE
		if online && finalMarketplace == marketplacev1.Marketplace_MARKETPLACE_UNSPECIFIED {
			return errOnlineNeedsMarketplace
		}

		updates := map[string]any{}

		if req.Msg.Type != nil {
			updates["type"] = channelTypeToText(finalType)
		}
		if req.Msg.Name != nil {
			updates["name"] = req.Msg.GetName()
		}
		if req.Msg.Url != nil {
			updates["url"] = req.Msg.GetUrl()
		}
		if req.Msg.Contact != nil {
			updates["contact"] = req.Msg.GetContact()
		}
		if req.Msg.Location != nil {
			updates["location"] = req.Msg.GetLocation()
		}

		// The stored marketplace follows the (possibly new) type — set it only when type or
		// marketplace is part of the patch, so an untouched offline channel isn't rewritten.
		if req.Msg.Type != nil || req.Msg.Marketplace != nil {
			if online {
				updates["marketplace"] = san_marketplace.ToText(finalMarketplace)
			} else {
				updates["marketplace"] = ""
			}
		}

		if len(updates) > 0 {
			updateErr := tx.
				Model(&inventory_service_models.SupplierChannel{}).
				Where("id = ?", channelID).
				Updates(withUpdatedAt(updates)).
				Error
			if updateErr != nil {
				return updateErr
			}
		}

		return tx.Where("id = ?", channelID).First(&channel).Error
	})
	if err != nil {
		return nil, channelErr(err)
	}

	return connect.NewResponse(&inventoryv1.SupplierChannelUpdateResponse{
		Channel: supplierChannelToProto(&channel),
	}), nil
}
