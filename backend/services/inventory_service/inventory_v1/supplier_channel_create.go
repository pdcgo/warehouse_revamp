package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// SupplierChannelCreate adds a channel to a supplier in the scoped team. An ONLINE channel must name
// a marketplace (else FailedPrecondition); an OFFLINE channel stores no marketplace. The supplier
// must be an active supplier in the team (else NotFound).
func (s *Service) SupplierChannelCreate(
	ctx context.Context,
	req *connect.Request[inventoryv1.SupplierChannelCreateRequest],
) (*connect.Response[inventoryv1.SupplierChannelCreateResponse], error) {
	teamID := req.Msg.GetTeamId()
	supplierID := req.Msg.GetSupplierId()
	chType := req.Msg.GetType()

	// An online channel is meaningless without a marketplace; reject it before touching the DB.
	if chType == inventoryv1.SupplierChannelType_SUPPLIER_CHANNEL_TYPE_ONLINE &&
		req.Msg.GetMarketplace() == marketplacev1.Marketplace_MARKETPLACE_UNSPECIFIED {
		return nil, channelErr(errOnlineNeedsMarketplace)
	}

	exists, err := supplierExists(s.db.WithContext(ctx), teamID, supplierID)
	if err != nil {
		return nil, channelErr(err)
	}
	if !exists {
		return nil, supplierNotFound()
	}

	// Only an online channel carries a marketplace; an offline one stores none.
	marketplace := ""
	if chType == inventoryv1.SupplierChannelType_SUPPLIER_CHANNEL_TYPE_ONLINE {
		marketplace = san_marketplace.ToText(req.Msg.GetMarketplace())
	}

	channel := &inventory_service_models.SupplierChannel{
		SupplierID:  supplierID,
		Type:        channelTypeToText(chType),
		Marketplace: marketplace,
		Name:        req.Msg.GetName(),
		URL:         req.Msg.GetUrl(),
		Contact:     req.Msg.GetContact(),
		Location:    req.Msg.GetLocation(),
	}

	err = s.db.WithContext(ctx).Create(channel).Error
	if err != nil {
		return nil, channelErr(err)
	}

	return connect.NewResponse(&inventoryv1.SupplierChannelCreateResponse{
		Channel: supplierChannelToProto(channel),
	}), nil
}
