package supplier_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// SupplierChannelUpdate writes the fields the request carries on a live store of a live supplier of the
// scoped team. The scope is checked and the row written in one UPDATE whose WHERE carries both — absent
// fields are left alone, so two edits of different fields both land.
func (s *Service) SupplierChannelUpdate(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierChannelUpdateRequest],
) (*connect.Response[supplierv1.SupplierChannelUpdateResponse], error) {
	msg := req.Msg
	teamID := msg.GetTeamId()
	channelID := msg.GetChannelId()

	updates := map[string]any{}
	if msg.ChannelType != nil {
		updates["channel_type"] = san_marketplace.ToText(msg.GetChannelType())
	}
	if msg.Name != nil {
		updates["name"] = msg.GetName()
	}
	if msg.Uri != nil {
		updates["uri"] = msg.GetUri()
	}
	if msg.Description != nil {
		updates["description"] = msg.GetDescription()
	}

	var channel *supplier_service_models.SupplierChannel

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if len(updates) > 0 {
			updates["updated_at"] = gorm.Expr("NOW()")

			res := tx.
				Model(&supplier_service_models.SupplierChannel{}).
				Where("id = ? AND deleted_at IS NULL", channelID).
				Where("supplier_id IN (SELECT id FROM suppliers WHERE team_id = ? AND deleted_at IS NULL)", teamID).
				Updates(updates)
			if res.Error != nil {
				return internal(res.Error)
			}

			if res.RowsAffected == 0 {
				return notFound(errChannelMissing)
			}
		}

		var loadErr error

		channel, loadErr = ownLiveChannel(tx, teamID, channelID)

		return loadErr
	})
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&supplierv1.SupplierChannelUpdateResponse{Channel: channelToProto(channel)}), nil
}
