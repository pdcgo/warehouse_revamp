package supplier_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// SupplierChannelCreate adds a store to a live supplier of the scoped team. The supplier is checked and the
// store written in one transaction, the supplier row locked FOR SHARE — so a delete racing the create
// either lands first (and the create is NotFound) or waits for it, never leaving a store added after the
// owner saw the supplier gone.
func (s *Service) SupplierChannelCreate(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierChannelCreateRequest],
) (*connect.Response[supplierv1.SupplierChannelCreateResponse], error) {
	msg := req.Msg

	channel := &supplier_service_models.SupplierChannel{
		SupplierID:  msg.GetSupplierId(),
		ChannelType: san_marketplace.ToText(msg.GetChannelType()),
		Name:        msg.GetName(),
		URI:         msg.GetUri(),
		Description: msg.GetDescription(),
	}

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		_, lockErr := ownLiveSupplier(tx.Clauses(forShare()), msg.GetTeamId(), msg.GetSupplierId())
		if lockErr != nil {
			return lockErr
		}

		createErr := tx.Create(channel).Error
		if createErr != nil {
			return internal(createErr)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&supplierv1.SupplierChannelCreateResponse{Channel: channelToProto(channel)}), nil
}
