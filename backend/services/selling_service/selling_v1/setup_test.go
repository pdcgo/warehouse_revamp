package selling_v1_test

import (
	"testing"

	"gorm.io/gorm"

	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

func newService(t *testing.T, db *gorm.DB) *selling_v1.Service {
	t.Helper()

	return selling_v1.NewService(db)
}

// insertShop seeds an active shop directly and returns its id.
func insertShop(t *testing.T, db *gorm.DB, teamID uint64, name, code, marketplace string) uint64 {
	t.Helper()

	s := selling_service_models.Shop{TeamID: teamID, Name: name, ShopCode: code, Marketplace: marketplace}

	err := db.Create(&s).Error
	if err != nil {
		t.Fatalf("insert shop: %v", err)
	}

	return s.ID
}
