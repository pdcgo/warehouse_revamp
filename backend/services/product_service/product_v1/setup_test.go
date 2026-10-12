package product_v1_test

import (
	"testing"

	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

func newService(t *testing.T, db *gorm.DB) *product_v1.Service {
	t.Helper()

	return product_v1.NewService(db)
}

// listRows pulls the PRODUCT (row) slice out of a guideline list response, keyed by product id. The
// list handlers default an empty data_request to the PRODUCT slice, so callers that don't set one get
// it here.
func listRows(items []*productv1.ProductListResponseItem) map[uint64]*productv1.ProductRowItem {
	for _, it := range items {
		row := it.GetProduct()
		if row != nil {
			return row.GetMapData()
		}
	}

	return map[uint64]*productv1.ProductRowItem{}
}

// byIdsRows flattens a by-ids response (map id -> list of slices) to the PRODUCT row per id.
func byIdsRows(items map[uint64]*productv1.ProductByIdsResponseList) map[uint64]*productv1.ProductRowItem {
	out := map[uint64]*productv1.ProductRowItem{}

	for id, list := range items {
		for _, it := range list.GetItems() {
			row := it.GetProduct()
			if row == nil {
				continue
			}

			r, ok := row.GetMapData()[id]
			if ok {
				out[id] = r
			}
		}
	}

	return out
}

// insertProduct seeds an active product directly and returns its id.
func insertProduct(t *testing.T, db *gorm.DB, teamID uint64, sku, name string) uint64 {
	t.Helper()

	p := product_service_models.Product{TeamID: teamID, SKU: sku, Name: name}

	err := db.Create(&p).Error
	if err != nil {
		t.Fatalf("insert product: %v", err)
	}

	return p.ID
}
