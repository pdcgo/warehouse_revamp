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
	// have to construct a liability ledger (#184) or an expense ledger (#211) it has no opinion about.
	return inventory_v1.NewService(db, nil, nil, nil, nil)
}

// fakeSuppliers is the SupplierChecker fake: supplier id → live. A deleted supplier is false; an id that
// exists nowhere is simply absent — both refused, as supplier_service refuses them.
type fakeSuppliers map[uint64]bool

func (f fakeSuppliers) SupplierIsLive(_ context.Context, _ uint64, supplierID uint64) (bool, error) {
	return f[supplierID], nil
}

// newServiceWithSuppliers is newService with suppliers to name — a restock naming one asks supplier_service.
func newServiceWithSuppliers(t *testing.T, db *gorm.DB, suppliers fakeSuppliers) *inventory_v1.Service {
	t.Helper()

	return inventory_v1.NewService(db, nil, nil, suppliers, nil)
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

	return inventory_v1.NewService(db, nil, expense, nil, nil)
}

// recordingPoster captures the COD obligations a fulfil posts, so a test can assert on WHAT was
// recorded rather than on whether some other service's table changed.
type recordingPoster struct {
	posted  []codPosting
	damaged []damagePosting
	fail    error
}

// courierNote is what every fixture here says the courier's charge at the door was for. A restock carries ONE such
// charge, as `warehouse_additional_cost` (the-courier-is-paid-once-per-restock), and its note is REQUIRED above 0
// (an-incidental-line-must-say-what-it-was-for) — so every accept that charges anything says what the money was.
const courierNote = "courier at the door"

type codPosting struct {
	sellingTeamID    uint64
	warehouseID      uint64
	restockRequestID uint64
	actorID          uint64
	amount           int64
}

func (p *recordingPoster) PostRestockOutlay(
	_ context.Context,
	_ *gorm.DB,
	sellingTeamID, warehouseID, restockRequestID, actorID uint64,
	amount int64,
) error {
	if p.fail != nil {
		return p.fail
	}

	p.posted = append(p.posted, codPosting{
		sellingTeamID:    sellingTeamID,
		warehouseID:      warehouseID,
		restockRequestID: restockRequestID,
		actorID:          actorID,
		amount:           amount,
	})

	return nil
}

// newServiceWithLiability is for the tests that care what reached the ledger (#184).
func newServiceWithLiability(
	t *testing.T,
	db *gorm.DB,
	poster inventory_v1.LiabilityPoster,
) *inventory_v1.Service {
	t.Helper()

	return inventory_v1.NewService(db, poster, nil, nil, nil)
}

// page1 is the first page at a generous limit — enough for the tiny fixtures here. Every inventory
// list RPC now takes the guideline CommonPagination.
func page1() *commonv1.CommonPagination {
	return &commonv1.CommonPagination{Page: 1, Limit: 50}
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

// damagePosting is one reimbursement the warehouse owes for stock it broke, lost, or found again
// (business_level §Warehouse 5).
type damagePosting struct {
	ownerTeamID uint64
	warehouseID uint64
	movementID  uint64
	actorID     uint64
	amount      int64
	kind        inventory_v1.StockDamageKind
}

// reversal is what the kind used to be: a boolean saying only whether the money was going back. Kept
// as a derived helper so the assertions that only care about direction still read the same, while
// the ones that care WHICH loss can now ask.
func (d damagePosting) reversal() bool {
	return d.kind == inventory_v1.StockDamageFound
}

// PostStockDamage records the debt side of a damaged/lost/found adjust. Kept on recordingPoster
// beside the outlay postings so one fake answers both halves of what inventory owes liability.
func (p *recordingPoster) PostStockDamage(
	_ context.Context,
	_ *gorm.DB,
	ownerTeamID, warehouseID, movementID, actorID uint64,
	amount int64,
	kind inventory_v1.StockDamageKind,
) error {
	if p.fail != nil {
		return p.fail
	}

	p.damaged = append(p.damaged, damagePosting{
		ownerTeamID: ownerTeamID,
		warehouseID: warehouseID,
		movementID:  movementID,
		actorID:     actorID,
		amount:      amount,
		kind:        kind,
	})

	return nil
}
