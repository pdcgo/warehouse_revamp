package inventory_v1_test

import (
	"context"
	"testing"

	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

func newService(t *testing.T, db *gorm.DB) *inventory_v1.Service {
	t.Helper()

	return inventory_v1.NewService(db)
}

// page1 is the first page at a generous limit — enough for the tiny fixtures here.
func page1() *commonv1.PageFilter {
	return &commonv1.PageFilter{Page: 1, Limit: 50}
}

// ctxUser puts an acting identity in ctx, as the access interceptor would, so the ledger records an
// actor. Handlers are called directly in these tests (no interceptor), so authorization is not
// exercised here — only the stock logic.
func ctxUser(id uint64) context.Context {
	return san_auth.WithIdentity(context.Background(), &role_basev1.Identity{
		IdentityId: id,
		Username:   "tester",
	})
}
