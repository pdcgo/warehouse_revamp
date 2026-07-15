package selling_v1

import (
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// The marketplace enum, as stored in the `marketplace` TEXT column. Keep in sync with the proto
// Marketplace enum — this mapper is the ONLY thing that writes/reads the value, so validity is
// guarded here (plus proto validation), not by a DB CHECK.
const (
	mpUnspecified = ""
	mpShopee      = "shopee"
	mpTokopedia   = "tokopedia"
	mpLazada      = "lazada"
	mpTiktok      = "tiktok"
	mpBlibli      = "blibli"
	mpBukalapak   = "bukalapak"
	mpOther       = "other"
)

func marketplaceToText(m sellingv1.Marketplace) string {
	switch m {
	case sellingv1.Marketplace_MARKETPLACE_SHOPEE:
		return mpShopee
	case sellingv1.Marketplace_MARKETPLACE_TOKOPEDIA:
		return mpTokopedia
	case sellingv1.Marketplace_MARKETPLACE_LAZADA:
		return mpLazada
	case sellingv1.Marketplace_MARKETPLACE_TIKTOK:
		return mpTiktok
	case sellingv1.Marketplace_MARKETPLACE_BLIBLI:
		return mpBlibli
	case sellingv1.Marketplace_MARKETPLACE_BUKALAPAK:
		return mpBukalapak
	case sellingv1.Marketplace_MARKETPLACE_OTHER:
		return mpOther
	default:
		return mpUnspecified
	}
}

func marketplaceFromText(text string) sellingv1.Marketplace {
	switch text {
	case mpShopee:
		return sellingv1.Marketplace_MARKETPLACE_SHOPEE
	case mpTokopedia:
		return sellingv1.Marketplace_MARKETPLACE_TOKOPEDIA
	case mpLazada:
		return sellingv1.Marketplace_MARKETPLACE_LAZADA
	case mpTiktok:
		return sellingv1.Marketplace_MARKETPLACE_TIKTOK
	case mpBlibli:
		return sellingv1.Marketplace_MARKETPLACE_BLIBLI
	case mpBukalapak:
		return sellingv1.Marketplace_MARKETPLACE_BUKALAPAK
	case mpOther:
		return sellingv1.Marketplace_MARKETPLACE_OTHER
	default:
		return sellingv1.Marketplace_MARKETPLACE_UNSPECIFIED
	}
}

func toProto(s *selling_service_models.Shop) *sellingv1.Shop {
	return &sellingv1.Shop{
		Id:          s.ID,
		TeamId:      s.TeamID,
		Name:        s.Name,
		ShopCode:    s.ShopCode,
		Marketplace: marketplaceFromText(s.Marketplace),
		Description: s.Description,
		Deleted:     s.Deleted,
	}
}
