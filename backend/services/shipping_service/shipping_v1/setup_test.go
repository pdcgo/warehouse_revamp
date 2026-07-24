package shipping_v1_test

import (
	"testing"

	"gorm.io/gorm"

	shipping_v1 "github.com/pdcgo/warehouse_revamp/backend/services/shipping_service/shipping_v1"
)

func newService(t *testing.T, db *gorm.DB) *shipping_v1.Service {
	t.Helper()

	return shipping_v1.NewService(db)
}
