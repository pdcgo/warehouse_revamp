package selling_v1

import (
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

func toProto(s *selling_service_models.Shop) *sellingv1.Shop {
	shop := &sellingv1.Shop{
		Id:          s.ID,
		TeamId:      s.TeamID,
		Name:        s.Name,
		ShopCode:    s.ShopCode,
		Marketplace: san_marketplace.FromText(s.Marketplace),
		Description: s.Description,
		Status:      shopStatusToProto(s.Status),

		PrimaryUserId: s.PrimaryUserID,
	}

	if s.ClosedAt != nil {
		shop.ClosedAtUnix = s.ClosedAt.Unix()
	}

	return shop
}

// shopStatusToProto maps the stored text to the enum (a-shop-is-closed-never-deleted). The column's CHECK allows only
// the two, so anything else is a row this code does not know — UNSPECIFIED rather than a guess.
func shopStatusToProto(status string) sellingv1.ShopStatus {
	switch status {
	case selling_service_models.ShopOpen:
		return sellingv1.ShopStatus_SHOP_STATUS_OPEN
	case selling_service_models.ShopClosed:
		return sellingv1.ShopStatus_SHOP_STATUS_CLOSED
	}

	return sellingv1.ShopStatus_SHOP_STATUS_UNSPECIFIED
}
