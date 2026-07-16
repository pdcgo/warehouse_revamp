package selling_v1

import (
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

func toProto(s *selling_service_models.Shop) *sellingv1.Shop {
	return &sellingv1.Shop{
		Id:          s.ID,
		TeamId:      s.TeamID,
		Name:        s.Name,
		ShopCode:    s.ShopCode,
		Marketplace: san_marketplace.FromText(s.Marketplace),
		Description: s.Description,
		Deleted:     s.Deleted,
	}
}
