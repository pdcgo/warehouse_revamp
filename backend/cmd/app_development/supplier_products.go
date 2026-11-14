package main

import (
	"context"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// supplierProductCatalog answers supplier_service's ProductCatalog from product_service's own rows, IN-PROCESS: the
// Produk tab's names, SKUs and pictures (a-supplier-product-row-says-whose-where-and-when) and its search among the
// supplier's own products (the-products-tab-searches-and-pages). The tab's policy already ran at SupplierProductList's
// door; ProductByIds names any team's product by id (another-team-sees-everything-of-a-supplier), and IDsMatchingAmong
// searches only the ids supplier_service hands over. Neither carries a price or a cost into a row.
//
// product_service reaches nothing of supplier_service, so this direction adds no cycle to the Wire graph (the supplier
// ExportStore already holds the same *product_v1.Service).
type supplierProductCatalog struct {
	products *product_v1.Service
}

func NewSupplierProductCatalog(products *product_v1.Service) supplier_v1.ProductCatalog {
	return supplierProductCatalog{products: products}
}

// ProductCards names a page of products — ProductByIds in-process, the picture its list-sized one (the full one when a
// product has no thumbnail, as ProductListItem falls back).
func (c supplierProductCatalog) ProductCards(ctx context.Context, ids []uint64) (map[uint64]supplier_v1.ProductCard, error) {
	out := map[uint64]supplier_v1.ProductCard{}
	if len(ids) == 0 {
		return out, nil
	}

	res, err := c.products.ProductByIds(ctx, connect.NewRequest(&productv1.ProductByIdsRequest{
		Filter:      &productv1.ProductByIdsFilter{Ids: ids},
		DataRequest: []productv1.ProductByIdsDataType{productv1.ProductByIdsDataType_PRODUCT_BY_IDS_DATA_TYPE_PRODUCT},
	}))
	if err != nil {
		return nil, err
	}

	for id, list := range res.Msg.GetItems() {
		for _, item := range list.GetItems() {
			row := item.GetProduct().GetMapData()[id]
			if row == nil {
				continue
			}

			picture := row.GetDefaultImageThumbnailUrl()
			if picture == "" {
				picture = row.GetDefaultImageUrl()
			}

			out[id] = supplier_v1.ProductCard{Name: row.GetName(), Code: row.GetProductCode(), ThumbnailURL: picture}
		}
	}

	return out, nil
}

// ProductIDsMatching is product_service's search among a known set — IDsMatchingAmong.
func (c supplierProductCatalog) ProductIDsMatching(ctx context.Context, among []uint64, q string) ([]uint64, error) {
	return c.products.IDsMatchingAmong(ctx, among, q)
}
