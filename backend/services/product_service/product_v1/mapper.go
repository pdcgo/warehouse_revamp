package product_v1

import (
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

func toProto(p *product_service_models.Product) *productv1.Product {
	images := make([]*productv1.ProductImage, 0, len(p.Images))
	for i := range p.Images {
		images = append(images, &productv1.ProductImage{
			Url:          p.Images[i].URL,
			ThumbnailUrl: p.Images[i].ThumbnailURL,
		})
	}

	return &productv1.Product{
		Id:                       p.ID,
		TeamId:                   p.TeamID,
		Sku:                      p.SKU,
		Name:                     p.Name,
		Description:              p.Description,
		CategoryId:               p.CategoryID,
		DefaultImageUrl:          p.DefaultImageURL,
		DefaultImageThumbnailUrl: p.DefaultImageThumbnailURL,
		Images:                   images,
		Deleted:                  p.Deleted,
	}
}

// modelImages turns request images into rows, preserving their order as Position (0 = cover).
func modelImages(in []*productv1.ProductImage) []product_service_models.ProductImage {
	out := make([]product_service_models.ProductImage, 0, len(in))
	for i, img := range in {
		out = append(out, product_service_models.ProductImage{
			URL:          img.GetUrl(),
			ThumbnailURL: img.GetThumbnailUrl(),
			Position:     i,
		})
	}

	return out
}

// coverOf returns the cover image (first entry) as (url, thumbnail), or empties when there are none.
// This is what gets denormalised onto the product row for cheap list rendering.
func coverOf(in []*productv1.ProductImage) (url, thumbnail string) {
	if len(in) > 0 {
		return in[0].GetUrl(), in[0].GetThumbnailUrl()
	}

	return "", ""
}
