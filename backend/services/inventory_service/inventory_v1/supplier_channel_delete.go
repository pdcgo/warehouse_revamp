package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// SupplierChannelDelete removes a channel outright (channels are not soft-deleted — they carry no
// history worth keeping). Scoped to the team through the channel's supplier: a channel outside the
// team reads as NotFound.
func (s *Service) SupplierChannelDelete(
	ctx context.Context,
	req *connect.Request[inventoryv1.SupplierChannelDeleteRequest],
) (*connect.Response[inventoryv1.SupplierChannelDeleteResponse], error) {
	teamID := req.Msg.GetTeamId()
	channelID := req.Msg.GetChannelId()

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Verify the channel is in this team FIRST (loadTeamChannel is the scope check), then delete.
		_, loadErr := loadTeamChannel(tx, teamID, channelID)
		if loadErr != nil {
			return loadErr
		}

		return tx.
			Where("id = ?", channelID).
			Delete(&inventory_service_models.SupplierChannel{}).
			Error
	})
	if err != nil {
		return nil, channelErr(err)
	}

	return connect.NewResponse(&inventoryv1.SupplierChannelDeleteResponse{}), nil
}
