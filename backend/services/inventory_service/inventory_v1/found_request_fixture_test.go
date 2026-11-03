package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// FOUND STOCK'S FIXTURE (an-adjust-found-waits-for-the-owner-or-admin) — the stock count's Gudang 5 (opnameStocked):
//
//	Melati's Kaos Hitam   Rak A 5 · Rak B 5   batch 1: 8 at Rp 10.000 (A 5, B 3) · batch 2: 2 at Rp 12.000 (B 2)
//	Sinar's  Kaos Polos   Rak A 4             one batch: 4 at Rp 20.000
//	Sinar's  Kaos Ungu    never stocked here
//	Rak C                 empty
//
// Ani and Dodi are staff; Budi is the warehouse Admin; Dewi the warehouse Owner; Root is outside the warehouse.

const opDewi uint64 = 44

func opOwner(id uint64) context.Context {
	return ctxAs(id, otWarehouse, role_basev1.Role_ROLE_WAREHOUSE_OWNER)
}

// report sends a found for approval through FoundRequestCreate, the one door.
func (f *opnameFixture) report(ctx context.Context, product, rack uint64, n int64, note string) (*inventoryv1.FoundRequest, error) {
	res, err := f.svc.FoundRequestCreate(ctx, connect.NewRequest(&inventoryv1.FoundRequestCreateRequest{
		TeamId: otWarehouse, ProductId: product, RackId: rack, Quantity: n, Note: note,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetFoundRequest(), nil
}

// mustReport is report, failing the test on a refusal.
func (f *opnameFixture) mustReport(t *testing.T, ctx context.Context, product, rack uint64, n int64) *inventoryv1.FoundRequest {
	t.Helper()

	r, err := f.report(ctx, product, rack, n, "behind the cartons")
	if err != nil {
		t.Fatalf("report %d of product %d on rack %d: %v", n, product, rack, err)
	}

	return r
}

func (f *opnameFixture) approve(ctx context.Context, id uint64) (*inventoryv1.FoundRequestApproveResponse, error) {
	res, err := f.svc.FoundRequestApprove(ctx, connect.NewRequest(&inventoryv1.FoundRequestApproveRequest{
		TeamId: otWarehouse, FoundRequestId: id,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

func (f *opnameFixture) reject(ctx context.Context, id uint64, reason string) (*inventoryv1.FoundRequest, error) {
	res, err := f.svc.FoundRequestReject(ctx, connect.NewRequest(&inventoryv1.FoundRequestRejectRequest{
		TeamId: otWarehouse, FoundRequestId: id, Reason: reason,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetFoundRequest(), nil
}

// foundList is one page of the list as the caller reads it, in its order.
func (f *opnameFixture) foundList(
	t *testing.T,
	ctx context.Context,
	status inventoryv1.FoundRequestStatus,
) []*inventoryv1.FoundRequest {
	t.Helper()

	res, err := f.svc.FoundRequestList(ctx, connect.NewRequest(&inventoryv1.FoundRequestListRequest{
		TeamId: otWarehouse, Filter: &inventoryv1.FoundRequestListFilter{Status: status}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("found request list: %v", err)
	}

	var m map[uint64]*inventoryv1.FoundRequest

	for _, item := range res.Msg.GetItems() {
		if r := item.GetRequest(); r != nil {
			m = r.GetMapData()
		}
	}

	out := make([]*inventoryv1.FoundRequest, 0, len(res.Msg.GetIds()))
	for _, id := range res.Msg.GetIds() {
		out = append(out, m[id])
	}

	return out
}

// foundRow is a request as stored.
func foundRow(t *testing.T, db *gorm.DB, id uint64) models.FoundRequest {
	t.Helper()

	var row models.FoundRequest

	err := db.Where("id = ?", id).Take(&row).Error
	if err != nil {
		t.Fatalf("read found request %d: %v", id, err)
	}

	return row
}

// txCount is how many inventory transactions exist — a write that posts nothing leaves it where it was.
func txCount(t *testing.T, db *gorm.DB) int64 {
	t.Helper()

	var n int64
	db.Model(&models.InventoryTransaction{}).Count(&n)

	return n
}

// ledgersAgree fails when a product's batches and its rack rows hold different totals.
func ledgersAgree(t *testing.T, db *gorm.DB, product uint64) int64 {
	t.Helper()

	var batches, racks int64
	db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM batches WHERE product_id = ?`, product).Scan(&batches)
	db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM product_placements WHERE product_id = ?`, product).Scan(&racks)

	if batches != racks {
		t.Fatalf("product %d: batches hold %d, racks %d — the ledgers drifted", product, batches, racks)
	}

	return racks
}

// verifyTx fails when a transaction's lines do not reconcile with its batch and rack logs.
func verifyTx(t *testing.T, db *gorm.DB, id uint64) {
	t.Helper()

	err := inventory_ledgers.Verify(db, id)
	if err != nil {
		t.Fatalf("Verify transaction %d: %v", id, err)
	}
}

// lostOne reports n units of a batch lost at the shelf — the register's open loss a found claims back.
func (f *opnameFixture) lostOne(t *testing.T, batch models.Batch, rack uint64, n int64) {
	t.Helper()

	_, err := f.svc.StockAdjust(opAdmin(opBudi), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: otWarehouse, ProductId: batch.ProductID, Place: &inventoryv1.StockAdjustRequest_RackId{RackId: rack},
		ReasonType: inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_LOST, BatchId: batch.ID, Quantity: n,
		Reason: "gone from the shelf",
	}))
	if err != nil {
		t.Fatalf("report %d of batch %d lost: %v", n, batch.ID, err)
	}
}

// inSavepoint runs fn and rolls everything it wrote back — so one test can run two paths from the same state and
// compare what each posted.
func inSavepoint(t *testing.T, db *gorm.DB, name string, fn func()) {
	t.Helper()

	err := db.SavePoint(name).Error
	if err != nil {
		t.Fatalf("savepoint %s: %v", name, err)
	}

	fn()

	err = db.RollbackTo(name).Error
	if err != nil {
		t.Fatalf("rollback to %s: %v", name, err)
	}
}
