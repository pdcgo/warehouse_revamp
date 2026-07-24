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

	// nil posters — NewService substitutes no-ops, so a test receiving a box onto a shelf does not
	// have to construct a settlement ledger (#184) or an expense ledger (#211) it has no opinion about.
	return inventory_v1.NewService(db, nil, nil)
}

// recordingExpense captures the stock-loss values an adjust posts, so a test can assert on WHAT was
// written off rather than on expense_service's table (#211).
type recordingExpense struct {
	posted []stockLoss
}

type stockLoss struct {
	warehouseID uint64
	amount      int64
	note        string
}

func (e *recordingExpense) PostStockLoss(_ context.Context, warehouseID uint64, amount int64, note string) error {
	e.posted = append(e.posted, stockLoss{warehouseID: warehouseID, amount: amount, note: note})
	return nil
}

// newServiceWithExpense is for the tests that care what a written-off batch cost (#211).
func newServiceWithExpense(t *testing.T, db *gorm.DB, expense inventory_v1.ExpensePoster) *inventory_v1.Service {
	t.Helper()

	return inventory_v1.NewService(db, nil, expense)
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

	return inventory_v1.NewService(db, poster, nil)
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
