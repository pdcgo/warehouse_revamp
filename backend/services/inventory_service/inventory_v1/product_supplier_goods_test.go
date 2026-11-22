package inventory_v1_test

import (
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// PEMASOK — who supplies a product (ProductSupplierGoods; the-supplier-tab-names-the-store,
// the-suppliers-are-a-tab-of-their-own): per supplier and the store it was bought at, the deliveries, the units, when
// last and — to the owning team only — the last unit cost. Melati (team 2) owns Kaos; Sinar (team 3) is another selling
// team reading it from the discover detail.
//
//	psgStocked, oldest first:
//	  1 day 1   Sumber · store A → Gudang 5   10 at Rp 10.000
//	  2 day 2   Sinar Jaya · no store → Gudang 5   6 at Rp 9.000
//	  3 day 3   Sumber · store B → Gudang 5    3 at Rp 11.000
//	  4 day 4   nobody → Gudang 5              5 at Rp 8.000     — names no supplier: no row
//	  5 day 5   Sumber · store A → Gudang 6    4 at Rp 12.000    — the newest delivery
//	  -         Sumber · store A → Gudang 5    7, CANCELLED while ongoing — never minted a batch
//	  -         a TRANSFER-IN at Gudang 6: 2 units of delivery 1, supplier and store copied — not a delivery

const (
	psgMelati  uint64 = 2
	psgSinar   uint64 = 3
	psgGudang5 uint64 = 5
	psgGudang6 uint64 = 6

	psgSumber    uint64 = 31
	psgSinarJaya uint64 = 32
	psgLain      uint64 = 34 // only ever reached Gudang 6 by a transfer

	psgStoreA    uint64 = 311
	psgStoreB    uint64 = 312
	psgStoreLain uint64 = 341

	psgKaos    uint64 = 801
	psgUnknown uint64 = 899
)

var psgDay0 = time.Date(2026, 10, 1, 9, 0, 0, 0, time.FixedZone("WIB", 7*3600))

func psgDay(n int) time.Time { return psgDay0.AddDate(0, 0, n) }

type psgFixture struct {
	svc *inventory_v1.Service
	db  *gorm.DB
	// rak5 is Gudang 5's shelf — where a correction takes units off or puts them.
	rak5 uint64
}

func psgService(t *testing.T) psgFixture {
	t.Helper()

	db := san_testdb.DB(t)
	suppliers := fakeSupplierService{
		fakeSuppliers: fakeSuppliers{psgSumber: true, psgSinarJaya: true, psgLain: true},
		stores: map[uint64]inventory_v1.SupplierStore{
			psgStoreA:    {SupplierID: psgSumber, Live: true},
			psgStoreB:    {SupplierID: psgSumber, Live: true},
			psgStoreLain: {SupplierID: psgLain, Live: true},
		},
	}
	facts := fakeFacts{psgKaos: {TeamID: psgMelati}}
	svc := inventory_v1.NewService(db, nil, nil, suppliers, nil, facts, nil, nil, nil, nil)

	return psgFixture{svc: svc, db: db, rak5: newRack(t, svc, psgGudang5, "rak-5")}
}

func psgStocked(t *testing.T) psgFixture {
	t.Helper()

	f := psgService(t)
	rak6 := newRack(t, f.svc, psgGudang6, "rak-6")

	psgDeliver(t, f, psgGudang5, f.rak5, 10, 100_000, psgSumber, psgStoreA, psgDay(1))
	psgDeliver(t, f, psgGudang5, f.rak5, 6, 54_000, psgSinarJaya, 0, psgDay(2))
	psgDeliver(t, f, psgGudang5, f.rak5, 3, 33_000, psgSumber, psgStoreB, psgDay(3))
	psgDeliver(t, f, psgGudang5, f.rak5, 5, 40_000, 0, 0, psgDay(4))
	psgDeliver(t, f, psgGudang6, rak6, 4, 48_000, psgSumber, psgStoreA, psgDay(5))

	// A CANCELLED restock — called off while on its way (a-restock-is-cancelled-only-while-ongoing).
	cancelled := psgCreate(t, f, psgGudang5, 7, 70_000, psgSumber, psgStoreA)

	_, err := f.svc.RestockRequestCancel(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
		TeamId: psgMelati, RequestId: cancelled.GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	// A TRANSFER-IN at Gudang 6 that copied delivery 1's supplier and store onto its batch (a-batch-keeps-its-supplier),
	// and one from a supplier this product was never restocked from at all.
	psgTransferIn(t, f.db, psgGudang6, 2, psgSumber, psgStoreA, psgDay(6))
	psgTransferIn(t, f.db, psgGudang6, 3, psgLain, psgStoreLain, psgDay(7))

	return f
}

func psgCreate(t *testing.T, f psgFixture, warehouse uint64, count int64, total float64, supplier, store uint64) *inventoryv1.RestockRequest {
	t.Helper()

	created, err := f.svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: psgMelati, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{{
			ProductId: psgKaos, ProductCode: "KAOS", Name: "Kaos", Count: count, Total: total,
			SupplierId: supplier, SupplierChannelId: store,
		}},
	}))
	if err != nil {
		t.Fatalf("restock create: %v", err)
	}

	return created.Msg.GetRequest()
}

// psgDeliver raises a restock of Kaos and accepts all of it as good stock, dated `at`.
func psgDeliver(t *testing.T, f psgFixture, warehouse, rack uint64, count int64, total float64, supplier, store uint64, at time.Time) *inventoryv1.RestockRequest {
	t.Helper()

	r := psgCreate(t, f, warehouse, count, total, supplier, store)

	_, err := f.svc.RestockRequestAccept(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId: r.GetItems()[0].GetId(), ReceivedCount: count,
			Placements: []*inventoryv1.RestockPlacement{{PlacementId: rack, Quantity: count}},
		}},
	}))
	if err != nil {
		t.Fatalf("restock accept: %v", err)
	}

	psgDate(t, f.db, r.GetId(), at)

	return r
}

// psgDate dates a restock's accept and its batches — the whole test is one database transaction, so NOW() never moves.
func psgDate(t *testing.T, db *gorm.DB, restockID uint64, at time.Time) {
	t.Helper()

	err := db.Exec(`UPDATE batches SET created_at = ? WHERE transaction_id = (SELECT transaction_id FROM restocks WHERE id = ?)`,
		at, restockID).Error
	if err != nil {
		t.Fatalf("date the batches: %v", err)
	}

	err = db.Exec(`UPDATE restocks SET accepted_at = ? WHERE id = ?`, at, restockID).Error
	if err != nil {
		t.Fatalf("date the accept: %v", err)
	}
}

func psgTransferIn(t *testing.T, db *gorm.DB, warehouse uint64, units int64, supplier, store uint64, at time.Time) {
	t.Helper()

	var txID uint64

	err := db.Raw(`
		INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, created_at, updated_at)
		VALUES (?, ?, 'transfer_in', ?, ?) RETURNING id`, warehouse, psgMelati, at, at).
		Scan(&txID).
		Error
	if err != nil {
		t.Fatalf("seed transfer: %v", err)
	}

	err = db.Exec(`
		INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                     init_stock_count, init_stock_valuation, supplier_id, supplier_channel_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, 10000, ?, ?, ?, ?, ?, ?, ?, ?)`,
		warehouse, psgMelati, psgKaos, txID, units, float64(units)*10000, units, float64(units)*10000, supplier, store, at, at).
		Error
	if err != nil {
		t.Fatalf("seed transferred batch: %v", err)
	}
}

func psgRead(t *testing.T, f psgFixture, caller, product, warehouse uint64, page *commonv1.CommonPagination) *inventoryv1.ProductSupplierGoodsResponse {
	t.Helper()

	res, err := f.svc.ProductSupplierGoods(ctxAs(41, caller, role_basev1.Role_ROLE_SELLING_OWNER), connect.NewRequest(&inventoryv1.ProductSupplierGoodsRequest{
		TeamId: caller,
		Filter: &inventoryv1.ProductSupplierGoodsFilter{ProductId: product, WarehouseId: warehouse},
		Page:   page,
	}))
	if err != nil {
		t.Fatalf("ProductSupplierGoods: %v", err)
	}

	return res.Msg
}

// psgRows is a page's rows in the order the ids give.
func psgRows(res *inventoryv1.ProductSupplierGoodsResponse) []*inventoryv1.ProductSupplierGoods {
	var m map[uint64]*inventoryv1.ProductSupplierGoods

	for _, item := range res.GetItems() {
		if g := item.GetGoods(); g != nil {
			m = g.GetMapData()
		}
	}

	rows := make([]*inventoryv1.ProductSupplierGoods, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		rows = append(rows, m[id])
	}

	return rows
}

type psgWant struct {
	supplier, store    uint64
	deliveries, units  int64
	last               time.Time
	cost               float64 // checked only when costShown
	costShown, checkAt bool
}

func psgCheck(t *testing.T, rows []*inventoryv1.ProductSupplierGoods, want []psgWant) {
	t.Helper()

	if len(rows) != len(want) {
		t.Fatalf("%d rows, want %d: %v", len(rows), len(want), rows)
	}

	for i, w := range want {
		r := rows[i]
		if r.GetSupplierId() != w.supplier || r.GetStoreId() != w.store {
			t.Fatalf("row %d is supplier %d store %d, want %d / %d", i, r.GetSupplierId(), r.GetStoreId(), w.supplier, w.store)
		}

		if r.GetDeliveries() != w.deliveries || r.GetUnits() != w.units {
			t.Fatalf("row %d (%d/%d): %d deliveries, %d units — want %d, %d",
				i, w.supplier, w.store, r.GetDeliveries(), r.GetUnits(), w.deliveries, w.units)
		}

		if w.checkAt && r.GetLastDeliveryUnix() != w.last.Unix() {
			t.Fatalf("row %d (%d/%d): last delivery %v, want %v",
				i, w.supplier, w.store, time.Unix(r.GetLastDeliveryUnix(), 0), w.last)
		}

		if (r.LastUnitCost != nil) != w.costShown {
			t.Fatalf("row %d (%d/%d): cost sent = %v, want %v", i, w.supplier, w.store, (r.LastUnitCost != nil), w.costShown)
		}

		if w.costShown && !san_money.Equal(r.GetLastUnitCost(), w.cost) {
			t.Fatalf("row %d (%d/%d): last cost %v, want %v", i, w.supplier, w.store, r.GetLastUnitCost(), w.cost)
		}
	}
}

// THE OWNER'S PAGE, every warehouse: one row per supplier and store, the newest delivery first. Sumber at store A — two
// deliveries (Gudang 5, then Gudang 6), 14 units, its last cost the NEWEST delivery's batch price; Sumber's store B apart;
// Sinar Jaya's no-store lines under Sinar Jaya with store 0 (a-line-with-no-store-links-under-the-supplier). The delivery
// from nobody is no row; the cancelled restock and the two transfer-ins count nowhere.
func TestProductSupplierGoods_TheOwnerReadsEverySupplierAndTheLastCost(t *testing.T) {
	f := psgStocked(t)

	res := psgRead(t, f, psgMelati, psgKaos, 0, page1())

	psgCheck(t, psgRows(res), []psgWant{
		{supplier: psgSumber, store: psgStoreA, deliveries: 2, units: 14, last: psgDay(5), checkAt: true, costShown: true, cost: 12_000},
		{supplier: psgSumber, store: psgStoreB, deliveries: 1, units: 3, last: psgDay(3), checkAt: true, costShown: true, cost: 11_000},
		{supplier: psgSinarJaya, store: 0, deliveries: 1, units: 6, last: psgDay(2), checkAt: true, costShown: true, cost: 9_000},
	})

	if got := res.GetPageInfo().GetTotalItems(); got != 3 {
		t.Fatalf("total %d, want 3", got)
	}
}

// ANOTHER SELLING TEAM reads the same rows — and NO cost: the field is absent from the answer, not a zero, so nothing of
// the owner's money crosses the wire (the-supplier-tab-names-the-store: Modal terakhir on the owner's page only). Proved
// on both wire formats Connect speaks: the JSON names no `lastUnitCost`, and the binary carries no field 7.
func TestProductSupplierGoods_AnotherTeamGetsNoCost(t *testing.T) {
	f := psgStocked(t)

	theirs := psgRead(t, f, psgSinar, psgKaos, 0, page1())

	psgCheck(t, psgRows(theirs), []psgWant{
		{supplier: psgSumber, store: psgStoreA, deliveries: 2, units: 14, last: psgDay(5), checkAt: true},
		{supplier: psgSumber, store: psgStoreB, deliveries: 1, units: 3},
		{supplier: psgSinarJaya, store: 0, deliveries: 1, units: 6},
	})

	ownJSON, err := protojson.Marshal(psgRead(t, f, psgMelati, psgKaos, 0, page1()))
	if err != nil {
		t.Fatalf("marshal the owner's: %v", err)
	}

	theirJSON, err := protojson.Marshal(theirs)
	if err != nil {
		t.Fatalf("marshal theirs: %v", err)
	}

	if !strings.Contains(string(ownJSON), `"lastUnitCost"`) {
		t.Fatalf("the owner's answer carries no cost: %s", ownJSON)
	}

	if strings.Contains(string(theirJSON), `"lastUnitCost"`) || strings.Contains(string(theirJSON), "12000") {
		t.Fatalf("another team's answer carries a cost: %s", theirJSON)
	}

	for _, row := range psgRows(theirs) {
		wire, marshalErr := proto.Marshal(row)
		if marshalErr != nil {
			t.Fatalf("marshal a row: %v", marshalErr)
		}

		var back inventoryv1.ProductSupplierGoods

		err = proto.Unmarshal(wire, &back)
		if err != nil {
			t.Fatalf("unmarshal a row: %v", err)
		}

		if back.LastUnitCost != nil || len(back.ProtoReflect().GetUnknown()) > 0 {
			t.Fatalf("a row carries a cost on the wire: %x", wire)
		}
	}
}

// THE WAREHOUSE PICKER (the-warehouse-picker-splits-the-page): only the deliveries RECEIVED there. Gudang 6 received one
// restock — Sumber's store A, 4 units — and two transfer-ins, which are not deliveries (a-supplier-page-is-scoped-by-its-
// warehouses: where the restocks were received): so store A reads 1 delivery of 4, and the supplier only a transfer
// brought there has no row. Gudang 5 holds the other three and store A's first delivery, its cost that delivery's.
func TestProductSupplierGoods_TheWarehousePickerNarrowsToItsDeliveries(t *testing.T) {
	f := psgStocked(t)

	psgCheck(t, psgRows(psgRead(t, f, psgMelati, psgKaos, psgGudang6, page1())), []psgWant{
		{supplier: psgSumber, store: psgStoreA, deliveries: 1, units: 4, last: psgDay(5), checkAt: true, costShown: true, cost: 12_000},
	})

	psgCheck(t, psgRows(psgRead(t, f, psgMelati, psgKaos, psgGudang5, page1())), []psgWant{
		{supplier: psgSumber, store: psgStoreB, deliveries: 1, units: 3, last: psgDay(3), checkAt: true, costShown: true, cost: 11_000},
		{supplier: psgSinarJaya, store: 0, deliveries: 1, units: 6, costShown: true, cost: 9_000},
		{supplier: psgSumber, store: psgStoreA, deliveries: 1, units: 10, last: psgDay(1), checkAt: true, costShown: true, cost: 10_000},
	})
}

// A TRANSFER IS NOT A DELIVERY (SupplierGoods' rule, TestSupplierGoods_ATransferIsNotARestock): a transfer-in copies the
// supplier and store onto the batch it mints, yet no supplier gains a delivery or a unit from it — not in the warehouse
// it reached, not across every warehouse.
func TestProductSupplierGoods_ATransferIsNotADelivery(t *testing.T) {
	f := psgService(t)
	rak6 := newRack(t, f.svc, psgGudang6, "rak-6")

	psgDeliver(t, f, psgGudang6, rak6, 4, 48_000, psgSumber, psgStoreA, psgDay(1))
	psgTransferIn(t, f.db, psgGudang6, 2, psgSumber, psgStoreA, psgDay(2))
	psgTransferIn(t, f.db, psgGudang6, 3, psgLain, psgStoreLain, psgDay(3))

	for _, warehouse := range []uint64{0, psgGudang6} {
		psgCheck(t, psgRows(psgRead(t, f, psgMelati, psgKaos, warehouse, page1())), []psgWant{
			{supplier: psgSumber, store: psgStoreA, deliveries: 1, units: 4, last: psgDay(1), checkAt: true, costShown: true, cost: 12_000},
		})
	}
}

// A CANCELLED RESTOCK IS NOT A DELIVERY: it is called off while on its way (a-restock-is-cancelled-only-while-ongoing)
// and never minted a batch — an accepted one cannot be cancelled (an-accepted-restock-cannot-be-cancelled). A product
// whose only restock was cancelled has no supplier.
func TestProductSupplierGoods_ACancelledRestockIsNotCounted(t *testing.T) {
	f := psgService(t)

	r := psgCreate(t, f, psgGudang5, 7, 70_000, psgSumber, psgStoreA)

	_, err := f.svc.RestockRequestCancel(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
		TeamId: psgMelati, RequestId: r.GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	if rows := psgRows(psgRead(t, f, psgMelati, psgKaos, 0, page1())); len(rows) != 0 {
		t.Fatalf("a cancelled restock reads as a supplier: %v", rows)
	}
}

// A RECEIVED-COUNT CORRECTION COUNTS IN (a-received-count-correction-counts-on-its-own-day: the supplier's restock
// figures move with it). Store A's first delivery, accepted as 10, is corrected to 8 — Unit reads 8, still one delivery.
// Sinar Jaya's line arrived with every unit broken (no good unit, no batch); corrected to 2 good, its batch is minted by
// the correction — still that restock's ONE delivery, dated at its accept, with those 2 units and their price.
func TestProductSupplierGoods_AReceivedCountCorrectionCountsIn(t *testing.T) {
	f := psgService(t)

	first := psgDeliver(t, f, psgGudang5, f.rak5, 10, 100_000, psgSumber, psgStoreA, psgDay(1))

	broken := psgCreate(t, f, psgGudang5, 4, 36_000, psgSinarJaya, 0)

	_, err := f.svc.RestockRequestAccept(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: psgGudang5, RequestId: broken.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId: broken.GetItems()[0].GetId(), ReceivedCount: 2, BrokenCount: 2,
		}},
	}))
	if err != nil {
		t.Fatalf("accept the broken line: %v", err)
	}

	psgDate(t, f.db, broken.GetId(), psgDay(2))

	if rows := psgRows(psgRead(t, f, psgMelati, psgKaos, 0, page1())); len(rows) != 1 {
		t.Fatalf("before the correction: %d rows, want store A's alone (a line with no good unit has no batch)", len(rows))
	}

	warehouseOwner := ctxAs(70, psgGudang5, role_basev1.Role_ROLE_WAREHOUSE_OWNER)

	for _, c := range []struct {
		restock          *inventoryv1.RestockRequest
		expected, actual int64
	}{
		{first, 10, 8},
		{broken, 2, 4},
	} {
		_, err = f.svc.RestockReceivedCountCorrect(warehouseOwner, connect.NewRequest(&inventoryv1.RestockReceivedCountCorrectRequest{
			TeamId: psgGudang5, RequestId: c.restock.GetId(), Reason: "Salah ketik saat terima",
			Lines: []*inventoryv1.ReceivedCountLine{{
				ItemId: c.restock.GetItems()[0].GetId(), ExpectedReceivedCount: c.expected, ReceivedCount: c.actual,
				PlacementId: f.rak5,
			}},
		}))
		if err != nil {
			t.Fatalf("correct restock %d: %v", c.restock.GetId(), err)
		}
	}

	psgCheck(t, psgRows(psgRead(t, f, psgMelati, psgKaos, 0, page1())), []psgWant{
		{supplier: psgSinarJaya, store: 0, deliveries: 1, units: 2, last: psgDay(2), checkAt: true, costShown: true, cost: 9_000},
		{supplier: psgSumber, store: psgStoreA, deliveries: 1, units: 8, last: psgDay(1), checkAt: true, costShown: true, cost: 10_000},
	})
}

// THE LIST PAGES (HARD RULE 9): positions 1… in order, the total on every page, and a page past the end still says it.
func TestProductSupplierGoods_Pages(t *testing.T) {
	f := psgStocked(t)

	page := func(n uint32) *inventoryv1.ProductSupplierGoodsResponse {
		return psgRead(t, f, psgMelati, psgKaos, 0, &commonv1.CommonPagination{Page: n, Limit: 2})
	}

	one, two, three := page(1), page(2), page(3)

	if ids := one.GetIds(); len(ids) != 2 || ids[0] != 1 || ids[1] != 2 {
		t.Fatalf("page 1 ids %v, want [1 2]", ids)
	}

	if rows := psgRows(two); len(rows) != 1 || rows[0].GetId() != 3 || rows[0].GetSupplierId() != psgSinarJaya {
		t.Fatalf("page 2 = %v, want Sinar Jaya at position 3", rows)
	}

	for i, res := range []*inventoryv1.ProductSupplierGoodsResponse{one, two, three} {
		if got := res.GetPageInfo().GetTotalItems(); got != 3 {
			t.Fatalf("page %d says %d in all, want 3", i+1, got)
		}
	}

	if len(three.GetIds()) != 0 {
		t.Fatalf("page 3 holds %v", three.GetIds())
	}
}

// A PRODUCT NOBODY OWNS (unknown to product_service) has no supplier.
func TestProductSupplierGoods_AnUnknownProductReadsNoRows(t *testing.T) {
	f := psgStocked(t)

	res := psgRead(t, f, psgMelati, psgUnknown, 0, page1())
	if len(res.GetIds()) != 0 || res.GetPageInfo().GetTotalItems() != 0 {
		t.Fatalf("an unknown product reads %v", res)
	}
}

// Who may read — Discover's people (DiscoverStockHistory's policy): the selling side and root; a warehouse has no product
// page. A read, so the monitor and an agent's credential may call it (an-agent-only-reads-for-now).
func TestProductSupplierGoods_TheSellingSideReads(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.ProductSupplierGoodsRequest")
	if err != nil {
		t.Fatalf("descriptor: %v", err)
	}

	roles := map[string]bool{}
	for _, role := range san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor)).GetRoles() {
		roles[role.String()] = true
	}

	for _, want := range []string{"ROLE_ROOT", "ROLE_ADMINISTRATOR", "ROLE_SELLING_OWNER", "ROLE_SELLING_ADMIN", "ROLE_SELLING_CS"} {
		if !roles[want] {
			t.Fatalf("%s may not read a product's suppliers", want)
		}
	}

	for _, refused := range []string{"ROLE_WAREHOUSE_OWNER", "ROLE_WAREHOUSE_ADMIN", "ROLE_WAREHOUSE_STAFF"} {
		if roles[refused] {
			t.Fatalf("%s may read a product's suppliers", refused)
		}
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.InventoryService.ProductSupplierGoods")
	if err != nil {
		t.Fatalf("method descriptor: %v", err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatalf("ProductSupplierGoods is not marked a read")
	}
}
