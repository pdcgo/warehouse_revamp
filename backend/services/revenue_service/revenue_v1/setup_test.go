package revenue_v1_test

import (
	"testing"

	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/revenue_service/revenue_v1"
)

func newService(t *testing.T, db *gorm.DB) *revenue_v1.Service {
	t.Helper()

	return revenue_v1.NewService(db)
}

func page1() *commonv1.PageFilter {
	return &commonv1.PageFilter{Page: 1, Limit: 20}
}
