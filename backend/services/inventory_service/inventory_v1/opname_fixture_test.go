package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE STOCK COUNT'S FIXTURE (docs/business/inventory/opname.md). Gudang 5 holds:
//
//	Melati's Kaos Hitam   Rak A 5 · Rak B 5   batch 1: 8 at Rp 10.000 (A 5, B 3) · batch 2: 2 at Rp 12.000 (B 2)
//	Sinar's  Kaos Polos   Rak A 4             one batch: 4 at Rp 20.000
//	Rak C                 empty
//
// Ani and Dodi are staff who count; Budi is the warehouse Admin who finalizes; Root is outside the warehouse.

const (
	opAni  uint64 = 41
	opDodi uint64 = 42
	opBudi uint64 = 43
	opRoot uint64 = 900

	// Sinar's, in its catalogue but never stocked in Gudang 5.
	opKaosUngu uint64 = 708
)

type opnameFixture struct {
	svc              *inventory_v1.Service
	db               *gorm.DB
	rakA, rakB, rakC uint64
	poster           *recordingPoster
	expense          *recordingExpense
}

func opFacts() fakeFacts {
	return fakeFacts{
		otKaosHitam: {TeamID: otMelati, ProductCode: "KH-01", Name: "Kaos Hitam"},
		otKaosPolos: {TeamID: otSinar, ProductCode: "KP-01", Name: "Kaos Polos"},
		opKaosUngu:  {TeamID: otSinar, ProductCode: "KU-01", Name: "Kaos Ungu"},
	}
}

func opnameStocked(t *testing.T) *opnameFixture {
	t.Helper()

	db := san_testdb.DB(t)
	f := &opnameFixture{db: db, poster: &recordingPoster{}, expense: &recordingExpense{}}
	f.svc = inventory_v1.NewService(db, f.poster, f.expense, nil, nil, opFacts(), nil, nil)

	f.rakA = newRack(t, f.svc, otWarehouse, "rak-a")
	f.rakB = newRack(t, f.svc, otWarehouse, "rak-b")
	f.rakC = newRack(t, f.svc, otWarehouse, "rak-c")

	otRestock(t, f.svc, otMelati, otKaosHitam, 8, 80000, []*inventoryv1.RestockPlacement{
		{PlacementId: f.rakA, Quantity: 5}, {PlacementId: f.rakB, Quantity: 3},
	})
	otRestock(t, f.svc, otMelati, otKaosHitam, 2, 24000, []*inventoryv1.RestockPlacement{{PlacementId: f.rakB, Quantity: 2}})
	otRestock(t, f.svc, otSinar, otKaosPolos, 4, 80000, []*inventoryv1.RestockPlacement{{PlacementId: f.rakA, Quantity: 4}})

	return f
}

// The request contexts the access interceptor would leave: who, in the warehouse, as what.
func opStaff(id uint64) context.Context {
	return ctxAs(id, otWarehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF)
}

func opAdmin(id uint64) context.Context {
	return ctxAs(id, otWarehouse, role_basev1.Role_ROLE_WAREHOUSE_ADMIN)
}

// Root, in through the root-team bypass — no role in the warehouse.
func opRootCtx() context.Context {
	return ctxAs(opRoot, otWarehouse, role_basev1.Role_ROLE_UNSPECIFIED)
}

// create plans a count as Budi.
func (f *opnameFixture) create(t *testing.T, plan inventoryv1.OpnamePlan, team, product, placement uint64) *inventoryv1.OpnameSession {
	t.Helper()

	res, err := f.svc.OpnameSessionCreate(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameSessionCreateRequest{
		TeamId: otWarehouse, Plan: plan, FilterTeamId: team, FilterProductId: product, FilterPlacementId: placement,
	}))
	if err != nil {
		t.Fatalf("create count: %v", err)
	}

	return res.Msg.GetSession()
}

// rows is every row of a session as the admin reads it, keyed by (product, rack).
func (f *opnameFixture) rows(t *testing.T, sessionID uint64) map[[2]uint64]*inventoryv1.OpnameRow {
	t.Helper()

	res, err := f.svc.OpnameRowList(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameRowListRequest{
		TeamId: otWarehouse, Filter: &inventoryv1.OpnameRowListFilter{SessionId: sessionID}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("row list: %v", err)
	}

	out := map[[2]uint64]*inventoryv1.OpnameRow{}

	for _, item := range res.Msg.GetItems() {
		for _, r := range item.GetRow().GetMapData() {
			out[[2]uint64{r.GetProductId(), r.GetPlacementId()}] = r
		}
	}

	return out
}

// row is one row of a session.
func (f *opnameFixture) row(t *testing.T, sessionID, product, rack uint64) *inventoryv1.OpnameRow {
	t.Helper()

	r := f.rows(t, sessionID)[[2]uint64{product, rack}]
	if r == nil {
		t.Fatalf("no row for product %d on rack %d", product, rack)
	}

	return r
}

func (f *opnameFixture) count(ctx context.Context, rowID uint64, n int64) (*inventoryv1.OpnameRow, error) {
	res, err := f.svc.OpnameRowCount(ctx, connect.NewRequest(&inventoryv1.OpnameRowCountRequest{
		TeamId: otWarehouse, RowId: rowID, Count: n,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetRow(), nil
}

func (f *opnameFixture) mark(ctx context.Context, rowID uint64, broken int64) (*inventoryv1.OpnameRow, error) {
	res, err := f.svc.OpnameRowMarkCounted(ctx, connect.NewRequest(&inventoryv1.OpnameRowMarkCountedRequest{
		TeamId: otWarehouse, RowId: rowID, BrokenCount: broken,
		BrokenNote: "torn at the seam", LostNote: "not found, checked under the shelf", SurplusNote: "found behind the box",
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetRow(), nil
}

// countRow counts one row as a staff member and marks it counted, with every reason given.
func (f *opnameFixture) countRow(t *testing.T, who uint64, sessionID, product, rack uint64, counted, broken int64) {
	t.Helper()

	r := f.row(t, sessionID, product, rack)

	_, err := f.count(opStaff(who), r.GetId(), counted)
	if err != nil {
		t.Fatalf("count product %d on rack %d: %v", product, rack, err)
	}

	_, err = f.mark(opStaff(who), r.GetId(), broken)
	if err != nil {
		t.Fatalf("mark product %d on rack %d: %v", product, rack, err)
	}
}

// countRest counts every row not yet counted exactly as its book says.
func (f *opnameFixture) countRest(t *testing.T, who, sessionID uint64) {
	t.Helper()

	for key, r := range f.rows(t, sessionID) {
		if r.GetStatus() == inventoryv1.OpnameRowStatus_OPNAME_ROW_STATUS_COUNTED {
			continue
		}

		f.countRow(t, who, sessionID, key[0], key[1], r.GetSystemStockCount(), 0)
	}
}

func (f *opnameFixture) finalize(ctx context.Context, sessionID uint64) (*inventoryv1.OpnameSessionFinalizeResponse, error) {
	res, err := f.svc.OpnameSessionFinalize(ctx, connect.NewRequest(&inventoryv1.OpnameSessionFinalizeRequest{
		TeamId: otWarehouse, SessionId: sessionID,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

func (f *opnameFixture) preview(ctx context.Context, sessionID uint64) (*inventoryv1.OpnameFinalizePreviewResponse, error) {
	res, err := f.svc.OpnameFinalizePreview(ctx, connect.NewRequest(&inventoryv1.OpnameFinalizePreviewRequest{
		TeamId: otWarehouse, SessionId: sessionID,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// moveOne carries one unit between racks — the write a count's lock refuses.
func (f *opnameFixture) moveOne(product, from, to uint64) error {
	_, err := f.svc.RackMove(opStaff(opAni), connect.NewRequest(&inventoryv1.RackMoveRequest{
		TeamId: otWarehouse, FromRackId: from, Lines: []*inventoryv1.RackMoveLine{{ProductId: product, Quantity: 1, ToRackId: to}},
	}))

	return err
}
