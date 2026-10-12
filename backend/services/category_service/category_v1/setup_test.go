package category_v1_test

import (
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/category_service/category_service_models"
	category_v1 "github.com/pdcgo/warehouse_revamp/backend/services/category_service/category_v1"
)

func newService(t *testing.T, db *gorm.DB) *category_v1.Service {
	t.Helper()

	return category_v1.NewService(db)
}

// insertCategory seeds an active category directly and returns its id. A nil parentID makes it
// top-level.
func insertCategory(t *testing.T, db *gorm.DB, name string, parentID *uint64) uint64 {
	t.Helper()

	c := category_service_models.Category{Name: name, ParentID: parentID}

	err := db.Create(&c).Error
	if err != nil {
		t.Fatalf("insert category: %v", err)
	}

	return c.ID
}
