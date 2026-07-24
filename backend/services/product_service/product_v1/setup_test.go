package product_v1_test

import (
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

func newService(t *testing.T, db *gorm.DB) *product_v1.Service {
	t.Helper()

	return product_v1.NewService(db)
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
