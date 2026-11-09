package inventory_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A SUPPLIER'S GOODS (SupplierGoods): what the batches bought from a supplier did — sold, ready, restocks — for every
// team's batches (every-selling-team-sees-every-teams-figures).

const (
	sgMelati    uint64 = 2
	sgSinar     uint64 = 3
	sgGudang5   uint64 = 5
	sgGudang6   uint64 = 6
	sgSumber    uint64 = 31 // PT Sumber Makmur — stores 311 and 312
	sgSinarJaya uint64 = 32 // no store: a market stall
	sgNobody    uint64 = 33 // never restocked from

	sgStoreA uint64 = 311
	sgStoreB uint64 = 312

	sgKaos   uint64 = 801 // Melati's
	sgCelana uint64 = 802 // Sinar's
	sgTopi   uint64 = 803 // Melati's, bought from nobody
)

var sgJakarta = time.FixedZone("WIB", 7*3600)

type sgFixture struct {
	svc *inventory_v1.Service
	db  *gorm.DB
}

// sgStocked: Melati restocks 10 Kaos from Sumber's store A into Gudang 5, then 4 more from store A into Gudang 6, and 5
// Topi from nobody; Sinar restocks 8 Celana from Sumber's store B into Gudang 5, and 6 Celana from Sinar Jaya (no
// store) into Gudang 5.
func sgStocked(t *testing.T) sgFixture {
	t.Helper()

	db := san_testdb.DB(t)
	suppliers := fakeSupplierService{
		fakeSuppliers: fakeSuppliers{sgSumber: true, sgSinarJaya: true},
		stores: map[uint64]inventory_v1.SupplierStore{
			sgStoreA: {SupplierID: sgSumber, Live: true},
			sgStoreB: {SupplierID: sgSumber, Live: true},
		},
	}
	facts := fakeFacts{sgKaos: {TeamID: sgMelati}, sgCelana: {TeamID: sgSinar}, sgTopi: {TeamID: sgMelati}}
	svc := inventory_v1.NewService(db, nil, nil, suppliers, nil, facts, nil, nil)

	rak5 := newRack(t, svc, sgGudang5, "rak-5")
	rak6 := newRack(t, svc, sgGudang6, "rak-6")

	sgRestock(t, svc, sgMelati, sgGudang5, rak5, sgKaos, 10, sgSumber, sgStoreA)
	sgRestock(t, svc, sgMelati, sgGudang6, rak6, sgKaos, 4, sgSumber, sgStoreA)
	sgRestock(t, svc, sgMelati, sgGudang5, rak5, sgTopi, 5, 0, 0)
	sgRestock(t, svc, sgSinar, sgGudang5, rak5, sgCelana, 8, sgSumber, sgStoreB)
	sgRestock(t, svc, sgSinar, sgGudang5, rak5, sgCelana, 6, sgSinarJaya, 0)

	return sgFixture{svc: svc, db: db}
}

func sgRestock(t *testing.T, svc *inventory_v1.Service, team, warehouse, rack, product uint64, count int64, supplier, store uint64) {
	t.Helper()

	created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: team, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{{
			ProductId: product, ProductCode: "SKU", Name: "Barang", Count: count, Total: float64(count * 10000),
			SupplierId: supplier, SupplierChannelId: store,
		}},
	}))
	if err != nil {
		t.Fatalf("restock create: %v", err)
	}

	r := created.Msg.GetRequest()

	_, err = svc.RestockRequestAccept(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId: r.GetItems()[0].GetId(), ReceivedCount: count,
			Placements: []*inventoryv1.RestockPlacement{{PlacementId: rack, Quantity: count}},
		}},
	}))
	if err != nil {
		t.Fatalf("restock accept: %v", err)
	}
}

// sgSell takes qty of a product for team's order under key, and returns the take's transaction.
func sgSell(t *testing.T, f sgFixture, team, warehouse, product uint64, qty int64, key string) uint64 {
	t.Helper()

	res, err := f.svc.OrderTransactionCreate(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId: team, IdempotencyKey: key, WarehouseId: warehouse,
		Lines: []*inventoryv1.OrderTransactionLine{{ProductId: product, Quantity: qty}},
	}))
	if err != nil {
		t.Fatalf("take %s: %v", key, err)
	}

	return res.Msg.GetTransactionId()
}

func sgCancel(t *testing.T, f sgFixture, team uint64, key string) {
	t.Helper()

	_, err := f.svc.OrderTransactionRelease(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
		TeamId: team, IdempotencyKey: key,
	}))
	if err != nil {
		t.Fatalf("release %s: %v", key, err)
	}
}

// sgStamp dates a transaction's batch rows — the whole test is one database transaction, so NOW() never moves.
func sgStamp(t *testing.T, db *gorm.DB, transactionID uint64, at time.Time) {
	t.Helper()

	err := db.Exec("UPDATE batch_logs SET created_at = ? WHERE transaction_id = ?", at, transactionID).Error
	if err != nil {
		t.Fatalf("stamp transaction %d: %v", transactionID, err)
	}
}

func sgGoods(t *testing.T, f sgFixture, caller uint64, group inventoryv1.SupplierGoodsGroup, ids ...uint64) map[[2]uint64]*inventoryv1.SupplierGoods {
	t.Helper()

	res, err := f.svc.SupplierGoods(context.Background(), connect.NewRequest(&inventoryv1.SupplierGoodsRequest{
		TeamId: caller, SupplierIds: ids, Group: group,
	}))
	if err != nil {
		t.Fatalf("SupplierGoods: %v", err)
	}

	out := map[[2]uint64]*inventoryv1.SupplierGoods{}
	for _, row := range res.Msg.GetRows() {
		out[[2]uint64{row.GetSupplierId(), row.GetStoreId() + row.GetWarehouseId()}] = row
	}

	return out
}

type sgWant struct {
	sold, orders, ready, restocks int64
}

func sgCheck(t *testing.T, name string, row *inventoryv1.SupplierGoods, want sgWant) {
	t.Helper()

	if row == nil {
		t.Fatalf("%s: no row, want %+v", name, want)
	}

	got := sgWant{sold: row.GetSoldUnits(), orders: row.GetOrders(), ready: row.GetReadyUnits(), restocks: row.GetRestocks()}
	if got != want {
		t.Fatalf("%s = %+v, want %+v", name, got, want)
	}
}

// Per supplier: every team's batches from it count — Melati's Kaos and Sinar's Celana are both Sumber's; a cancelled
// order is counted back and is not an order; a batch from nobody and a supplier never bought from have no figures.
func TestSupplierGoods_CountsEveryTeamsGoodsAndTakesACancelBack(t *testing.T) {
	f := sgStocked(t)

	sgSell(t, f, sgMelati, sgGudang5, sgKaos, 3, "sg-1")
	sgSell(t, f, sgMelati, sgGudang5, sgKaos, 2, "sg-2")
	sgCancel(t, f, sgMelati, "sg-2")
	sgSell(t, f, sgSinar, sgGudang5, sgCelana, 9, "sg-3") // 8 from Sumber's batch first (FIFO), 1 from Sinar Jaya's
	sgSell(t, f, sgMelati, sgGudang5, sgTopi, 5, "sg-4")

	rows := sgGoods(t, f, sgMelati, inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_SUPPLIER, sgSumber, sgSinarJaya, sgNobody)

	// Sumber: 3 Kaos + 8 Celana sold on 2 orders; 7 + 4 Kaos ready; 3 restocks (two Melati's, one Sinar's).
	sgCheck(t, "Sumber", rows[[2]uint64{sgSumber, 0}], sgWant{sold: 11, orders: 2, ready: 11, restocks: 3})
	sgCheck(t, "Sinar Jaya", rows[[2]uint64{sgSinarJaya, 0}], sgWant{sold: 1, orders: 1, ready: 5, restocks: 1})

	if row := rows[[2]uint64{sgNobody, 0}]; row != nil {
		t.Fatalf("a supplier never bought from has a row: %+v", row)
	}

	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2 — Topi was bought from nobody", len(rows))
	}
}

// Another team reads the same figures — nothing about a supplier is private (every-selling-team-sees-every-teams-figures):
// the caller's team only authorizes.
func TestSupplierGoods_AnotherTeamReadsTheSameFigures(t *testing.T) {
	f := sgStocked(t)

	sgSell(t, f, sgMelati, sgGudang5, sgKaos, 3, "sg-1")

	mine := sgGoods(t, f, sgMelati, inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_SUPPLIER, sgSumber)
	theirs := sgGoods(t, f, 99, inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_SUPPLIER, sgSumber)

	sgCheck(t, "Melati reads", mine[[2]uint64{sgSumber, 0}], sgWant{sold: 3, orders: 1, ready: 19, restocks: 3})
	sgCheck(t, "team 99 reads", theirs[[2]uint64{sgSumber, 0}], sgWant{sold: 3, orders: 1, ready: 19, restocks: 3})
}

// Per store and per warehouse: the Toko tab and Gudang terkait split the same goods.
func TestSupplierGoods_SplitsByStoreAndByWarehouse(t *testing.T) {
	f := sgStocked(t)

	sgSell(t, f, sgMelati, sgGudang6, sgKaos, 1, "sg-1")
	sgSell(t, f, sgSinar, sgGudang5, sgCelana, 2, "sg-2")

	stores := sgGoods(t, f, sgMelati, inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE, sgSumber, sgSinarJaya)
	sgCheck(t, "store A", stores[[2]uint64{sgSumber, sgStoreA}], sgWant{sold: 1, orders: 1, ready: 13, restocks: 2})
	sgCheck(t, "store B", stores[[2]uint64{sgSumber, sgStoreB}], sgWant{sold: 2, orders: 1, ready: 6, restocks: 1})
	sgCheck(t, "Sinar Jaya, no store", stores[[2]uint64{sgSinarJaya, 0}], sgWant{ready: 6, restocks: 1})

	houses := sgGoods(t, f, sgMelati, inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_WAREHOUSE, sgSumber)
	sgCheck(t, "Gudang 5", houses[[2]uint64{sgSumber, sgGudang5}], sgWant{sold: 2, orders: 1, ready: 16, restocks: 2})
	sgCheck(t, "Gudang 6", houses[[2]uint64{sgSumber, sgGudang6}], sgWant{sold: 1, orders: 1, ready: 3, restocks: 1})

	if len(houses) != 2 {
		t.Fatalf("got %d warehouses, want 2", len(houses))
	}
}

// The last order is the newest order that was NOT cancelled; the last restock the newest restock batch.
func TestSupplierGoods_TheLastOrderSkipsACancelledOne(t *testing.T) {
	f := sgStocked(t)

	kept := sgSell(t, f, sgMelati, sgGudang5, sgKaos, 1, "sg-1")
	cancelled := sgSell(t, f, sgMelati, sgGudang5, sgKaos, 1, "sg-2")
	sgCancel(t, f, sgMelati, "sg-2")

	// 23:30 WIB on 1 Nov is 16:30 UTC — the instant travels, the screen names the Jakarta day.
	keptAt := time.Date(2026, 11, 1, 23, 30, 0, 0, sgJakarta)
	sgStamp(t, f.db, kept, keptAt)
	sgStamp(t, f.db, cancelled, time.Date(2026, 11, 5, 9, 0, 0, 0, sgJakarta))

	restockAt := time.Date(2026, 10, 20, 8, 0, 0, 0, sgJakarta)
	err := f.db.Exec("UPDATE batches SET created_at = ? WHERE supplier_id = ?", restockAt, sgSumber).Error
	if err != nil {
		t.Fatalf("stamp batches: %v", err)
	}

	err = f.db.Exec(
		"UPDATE batches SET created_at = ? WHERE supplier_id = ? AND warehouse_id = ?",
		restockAt.Add(48*time.Hour), sgSumber, sgGudang6,
	).Error
	if err != nil {
		t.Fatalf("stamp Gudang 6's batch: %v", err)
	}

	row := sgGoods(t, f, sgMelati, inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_SUPPLIER, sgSumber)[[2]uint64{sgSumber, 0}]

	if row.GetLastOrderUnix() != keptAt.Unix() {
		t.Fatalf("last order = %v, want %v — the cancelled 5 Nov order is not the last", time.Unix(row.GetLastOrderUnix(), 0).In(sgJakarta), keptAt)
	}

	if row.GetLastRestockUnix() != restockAt.Add(48*time.Hour).Unix() {
		t.Fatalf("last restock = %v, want %v", time.Unix(row.GetLastRestockUnix(), 0).In(sgJakarta), restockAt.Add(48*time.Hour))
	}

	sgCheck(t, "Sumber", row, sgWant{sold: 1, orders: 1, ready: 21, restocks: 3})
}

// A transfer-in mints a batch carrying the supplier: its units are ready, and it is not a restock.
func TestSupplierGoods_ATransferIsNotARestock(t *testing.T) {
	f := sgStocked(t)

	err := f.db.Exec(`
		INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, created_at, updated_at)
		VALUES (?, ?, 'transfer_in', NOW(), NOW())`, sgGudang6, sgSinar).Error
	if err != nil {
		t.Fatalf("seed transfer: %v", err)
	}

	var txID uint64
	f.db.Raw("SELECT MAX(id) FROM inventory_transactions WHERE tx_type = 'transfer_in'").Scan(&txID)

	err = f.db.Exec(`
		INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                     init_stock_count, init_stock_valuation, supplier_id, supplier_channel_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, 10000, 2, 20000, 2, 20000, ?, ?, NOW(), NOW())`,
		sgGudang6, sgSinar, sgCelana, txID, sgSumber, sgStoreB).Error
	if err != nil {
		t.Fatalf("seed transferred batch: %v", err)
	}

	row := sgGoods(t, f, sgSinar, inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_SUPPLIER, sgSumber)[[2]uint64{sgSumber, 0}]
	sgCheck(t, "Sumber", row, sgWant{ready: 24, restocks: 3})
}

// Who may read: the selling side and root — a warehouse has no supplier pages (only-a-selling-team-has-suppliers).
func TestSupplierGoods_TheSellingSideReads(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.SupplierGoodsRequest")
	if err != nil {
		t.Fatalf("descriptor: %v", err)
	}

	roles := map[string]bool{}
	for _, role := range san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor)).GetRoles() {
		roles[role.String()] = true
	}

	for _, want := range []string{"ROLE_ROOT", "ROLE_ADMINISTRATOR", "ROLE_SELLING_OWNER", "ROLE_SELLING_ADMIN", "ROLE_SELLING_CS"} {
		if !roles[want] {
			t.Fatalf("%s may not read a supplier's goods", want)
		}
	}

	for _, refused := range []string{"ROLE_WAREHOUSE_OWNER", "ROLE_WAREHOUSE_ADMIN", "ROLE_WAREHOUSE_STAFF"} {
		if roles[refused] {
			t.Fatalf("%s may read a supplier's goods", refused)
		}
	}
}
