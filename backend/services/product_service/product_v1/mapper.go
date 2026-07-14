package product_v1

import (
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

func toProto(p *product_service_models.Product) *productv1.Product {
	return &productv1.Product{
		Id:          p.ID,
		TeamId:      p.TeamID,
		Sku:         p.SKU,
		Name:        p.Name,
		Description: p.Description,
		Deleted:     p.Deleted,
	}
}
