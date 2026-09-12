package inventory_v1

import (
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// The channel type, as stored in the `type` TEXT column. Mapped here (plus proto validation), not by
// a DB CHECK IN-list (the #80 drift trap).
const (
	channelTypeOnline  = "online"
	channelTypeOffline = "offline"
)

var (
	errChannelMissing = errors.New("supplier channel not found")
	// An online channel must name a marketplace; an offline one must not (it has none).
	errOnlineNeedsMarketplace = errors.New("an online channel needs a marketplace")
)

func channelTypeToText(t inventoryv1.SupplierChannelType) string {
	switch t {
	case inventoryv1.SupplierChannelType_SUPPLIER_CHANNEL_TYPE_ONLINE:
		return channelTypeOnline
	case inventoryv1.SupplierChannelType_SUPPLIER_CHANNEL_TYPE_OFFLINE:
		return channelTypeOffline
	default:
		return ""
	}
}

func channelTypeFromText(text string) inventoryv1.SupplierChannelType {
	switch text {
	case channelTypeOnline:
		return inventoryv1.SupplierChannelType_SUPPLIER_CHANNEL_TYPE_ONLINE
	case channelTypeOffline:
		return inventoryv1.SupplierChannelType_SUPPLIER_CHANNEL_TYPE_OFFLINE
	default:
		return inventoryv1.SupplierChannelType_SUPPLIER_CHANNEL_TYPE_UNSPECIFIED
	}
}

func supplierChannelToProto(c *inventory_service_models.SupplierChannel) *inventoryv1.SupplierChannel {
	return &inventoryv1.SupplierChannel{
		Id:          c.ID,
		SupplierId:  c.SupplierID,
		Type:        channelTypeFromText(c.Type),
		Marketplace: san_marketplace.FromText(c.Marketplace),
		Name:        c.Name,
		Url:         c.URL,
		Contact:     c.Contact,
		Location:    c.Location,
	}
}

// loadTeamChannel loads a channel BY ID, scoped to the team through its supplier: the JOIN requires
// the channel's supplier to be an active supplier IN THIS TEAM. A channel belonging to another team's
// supplier (or a soft-deleted one) reads as errChannelMissing → NotFound. This is the scope check for
// the by-id RPCs (update/delete).
func loadTeamChannel(tx *gorm.DB, teamID, channelID uint64) (*inventory_service_models.SupplierChannel, error) {
	var ch inventory_service_models.SupplierChannel

	err := tx.
		Joins("JOIN suppliers ON suppliers.id = supplier_channels.supplier_id").
		Where("supplier_channels.id = ? AND suppliers.team_id = ? AND suppliers.deleted = ?", channelID, teamID, false).
		First(&ch).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, errChannelMissing
	}
	if err != nil {
		return nil, err
	}

	return &ch, nil
}

// channelErr maps a missing channel/supplier to NotFound, an online/marketplace mismatch to
// FailedPrecondition (a client error), and everything else to Internal.
func channelErr(err error) error {
	switch {
	case errors.Is(err, errChannelMissing), errors.Is(err, gorm.ErrRecordNotFound):
		return connect.NewError(connect.CodeNotFound, errChannelMissing)
	case errors.Is(err, errOnlineNeedsMarketplace):
		return connect.NewError(connect.CodeFailedPrecondition, errOnlineNeedsMarketplace)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
