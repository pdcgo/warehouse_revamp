package product_v1

import (
	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
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

// ── Guideline list/by-ids slices (guidelines/service-guideline.md) ────────────────────────────────

// productRowItem is the PRODUCT (row) slice — the fields a product list/card renders. Mirrors Product
// minus the images gallery, which a list never carries.
func productRowItem(p *product_service_models.Product) *productv1.ProductRowItem {
	return &productv1.ProductRowItem{
		Id:                       p.ID,
		TeamId:                   p.TeamID,
		Sku:                      p.SKU,
		Name:                     p.Name,
		Description:              p.Description,
		CategoryId:               p.CategoryID,
		DefaultImageUrl:          p.DefaultImageURL,
		DefaultImageThumbnailUrl: p.DefaultImageThumbnailURL,
		Deleted:                  p.Deleted,
	}
}

// productOrderClause maps a ListFilterSort to a safe "column DIR" ORDER BY. The columns are a fixed
// whitelist, never caller text. Default (no sort) is newest-first (id DESC), the legacy behaviour.
func productOrderClause(sort *productv1.ProductListFilterSort) string {
	col := "id"
	dir := "DESC"

	if sort != nil {
		if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_ASC {
			dir = "ASC"
		}

		switch s := sort.GetS().(type) {
		case *productv1.ProductListFilterSort_General:
			if s.General == commonv1.GeneralSort_GENERAL_SORT_NAME {
				col = "name"
			}
		case *productv1.ProductListFilterSort_Product:
			switch s.Product {
			case productv1.ProductRowSort_PRODUCT_ROW_SORT_NAME:
				col = "name"
			case productv1.ProductRowSort_PRODUCT_ROW_SORT_SKU:
				col = "sku"
			case productv1.ProductRowSort_PRODUCT_ROW_SORT_ID:
				col = "id"
			}
		}
	}

	return col + " " + dir
}

// productGeneralMap / productRowMap build the two per-id slice payloads from products already in
// display order.
func productGeneralMap(products []product_service_models.Product) *commonv1.GeneralMapItem {
	m := make(map[uint64]*commonv1.GeneralItem, len(products))
	for i := range products {
		m[products[i].ID] = &commonv1.GeneralItem{Id: products[i].ID, Name: products[i].Name}
	}

	return &commonv1.GeneralMapItem{MapData: m}
}

func productRowMap(products []product_service_models.Product) *productv1.ProductRowMapItem {
	m := make(map[uint64]*productv1.ProductRowItem, len(products))
	for i := range products {
		m[products[i].ID] = productRowItem(&products[i])
	}

	return &productv1.ProductRowMapItem{MapData: m}
}

// productListItems builds the response slices for the requested data types (defaulting to the PRODUCT
// row slice) plus the sorted id list, from products already in display order.
func productListItems(
	products []product_service_models.Product,
	types []productv1.ProductListDataType,
) ([]*productv1.ProductListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []productv1.ProductListDataType{productv1.ProductListDataType_PRODUCT_LIST_DATA_TYPE_PRODUCT}
	}

	ids := make([]uint64, 0, len(products))
	for i := range products {
		ids = append(ids, products[i].ID)
	}

	items := make([]*productv1.ProductListResponseItem, 0, len(types))
	for _, t := range types {
		switch t {
		case productv1.ProductListDataType_PRODUCT_LIST_DATA_TYPE_GENERAL:
			items = append(items, &productv1.ProductListResponseItem{
				D: &productv1.ProductListResponseItem_General{General: productGeneralMap(products)},
			})
		case productv1.ProductListDataType_PRODUCT_LIST_DATA_TYPE_PRODUCT:
			items = append(items, &productv1.ProductListResponseItem{
				D: &productv1.ProductListResponseItem_Product{Product: productRowMap(products)},
			})
		}
	}

	return items, ids
}

// productByIdsMap builds the by-ids response: a map keyed by product id, each value holding the
// requested slices for that one product (defaulting to the PRODUCT row slice).
func productByIdsMap(
	products []product_service_models.Product,
	types []productv1.ProductByIdsDataType,
) map[uint64]*productv1.ProductByIdsResponseList {
	if len(types) == 0 {
		types = []productv1.ProductByIdsDataType{productv1.ProductByIdsDataType_PRODUCT_BY_IDS_DATA_TYPE_PRODUCT}
	}

	out := make(map[uint64]*productv1.ProductByIdsResponseList, len(products))
	for i := range products {
		one := products[i : i+1]

		slices := make([]*productv1.ProductByIdsResponseItem, 0, len(types))
		for _, t := range types {
			switch t {
			case productv1.ProductByIdsDataType_PRODUCT_BY_IDS_DATA_TYPE_GENERAL:
				slices = append(slices, &productv1.ProductByIdsResponseItem{
					D: &productv1.ProductByIdsResponseItem_General{General: productGeneralMap(one)},
				})
			case productv1.ProductByIdsDataType_PRODUCT_BY_IDS_DATA_TYPE_PRODUCT:
				slices = append(slices, &productv1.ProductByIdsResponseItem{
					D: &productv1.ProductByIdsResponseItem_Product{Product: productRowMap(one)},
				})
			}
		}

		out[products[i].ID] = &productv1.ProductByIdsResponseList{Items: slices}
	}

	return out
}
