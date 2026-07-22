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

	// nil poster — NewService substitutes a no-op, so a test receiving a box onto a shelf does not
	// have to construct a ledger it has no opinion about (#184).
	return inventory_v1.NewService(db, nil)
}

// recordingPoster captures the COD obligations a fulfil posts, so a test can assert on WHAT was
// recorded rather than on whether some other service's table changed.
type recordingPoster struct {
	posted []codPosting
	fail   error
}

type codPosting struct {
	sellingTeamID    uint64
	warehouseID      uint64
	restockRequestID uint64
	amount           int64
}

func (p *recordingPoster) PostCODFee(
	_ context.Context,
	_ *gorm.DB,
	sellingTeamID, warehouseID, restockRequestID uint64,
	amount int64,
) error {
	if p.fail != nil {
		return p.fail
	}

	p.posted = append(p.posted, codPosting{
		sellingTeamID:    sellingTeamID,
		warehouseID:      warehouseID,
		restockRequestID: restockRequestID,
		amount:           amount,
	})

	return nil
}

// newServiceWithSettlement is for the tests that care what reached the ledger (#184).
func newServiceWithSettlement(
	t *testing.T,
	db *gorm.DB,
	poster inventory_v1.SettlementPoster,
) *inventory_v1.Service {
	t.Helper()

	return inventory_v1.NewService(db, poster)
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
