package main

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE REPRINT CLEARS THE TAG, THROUGH THE REAL SEAMS (backlog #151, #141 P3; products-have-their-own-tag-list, its 🔄
// *what clears*; the acceptance docs/acceptances/teams/team_code.md givens 3–4): team_service's TeamCodeUpdate tags the
// products some warehouse holds (#149), inventory's Cetak Ulang Kode lists them — one label per shelf spot, the live code,
// the former code — and its recorded print clears THIS warehouse's wait, taking `need_reprint_code` off after the last
// holding warehouse; a transfer accepted while tagged makes the receiving warehouse wait too (scope141 ⚠6); Cetak Label
// prints the LIVE code (⚠1).

// asWarehouseStaff is a warehouse's Staff (user 88) inside it.
func asWarehouseStaff(warehouse uint64) context.Context {
	ctx := san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: 88, Username: "staff"})
	ctx = san_auth.WithScope(ctx, warehouse)

	return san_auth.WithCallerRole(ctx, role_basev1.Role_ROLE_WAREHOUSE_STAFF)
}

// rackAt makes a shelf spot in the warehouse (its code is stored lowercased).
func rackAt(t *testing.T, inventory *inventory_v1.Service, warehouse uint64, code string) uint64 {
	t.Helper()

	rack, err := inventory.RackCreate(context.Background(), connect.NewRequest(&inventoryv1.RackCreateRequest{
		TeamId: warehouse, Code: code, Name: "Rak " + code,
	}))
	if err != nil {
		t.Fatalf("rack %s: %v", code, err)
	}

	return rack.Msg.GetRack().GetId()
}

// restockOnto stocks the product in the warehouse by an accepted restock whose line carries the code `copied` — the
// line's own copy — putting the units on the spots given. Answers the restock's id.
func restockOnto(
	t *testing.T,
	inventory *inventory_v1.Service,
	team, warehouse, product uint64,
	copied string,
	spots ...*inventoryv1.RestockPlacement,
) uint64 {
	t.Helper()

	var count int64
	for _, s := range spots {
		count += s.GetQuantity()
	}

	ctx := context.Background()

	created, err := inventory.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: team, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: product, ProductCode: copied, Name: "Barang", Count: count, Total: float64(count * 10000)}},
	}))
	if err != nil {
		t.Fatalf("restock create: %v", err)
	}

	r := created.Msg.GetRequest()

	_, err = inventory.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{ItemId: r.GetItems()[0].GetId(), ReceivedCount: count, Placements: spots}},
	}))
	if err != nil {
		t.Fatalf("restock accept: %v", err)
	}

	return r.GetId()
}

func spot(rack uint64, quantity int64) *inventoryv1.RestockPlacement {
	return &inventoryv1.RestockPlacement{PlacementId: rack, Quantity: quantity}
}

func (w codeEditWorld) changeCode(t *testing.T, team uint64, code string) {
	t.Helper()

	_, err := w.teams.TeamCodeUpdate(asOwnerOf(team), connect.NewRequest(&teamv1.TeamCodeUpdateRequest{TeamId: team, TeamCode: code}))
	if err != nil {
		t.Fatalf("TeamCodeUpdate → %s: %v", code, err)
	}
}

func (w codeEditWorld) reprintList(t *testing.T, warehouse uint64) *inventoryv1.ProductReprintListResponse {
	t.Helper()

	res, err := w.inventory.ProductReprintList(asWarehouseStaff(warehouse), connect.NewRequest(&inventoryv1.ProductReprintListRequest{
		WarehouseId: warehouse, Page: &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductReprintList(%d): %v", warehouse, err)
	}

	return res.Msg
}

// record is the page's Cetak: every item of the list, with the code it read.
func (w codeEditWorld) record(t *testing.T, warehouse uint64, items ...*inventoryv1.ProductReprintPrinted) *inventoryv1.ProductReprintRecordResponse {
	t.Helper()

	res, err := w.inventory.ProductReprintRecord(asWarehouseStaff(warehouse), connect.NewRequest(&inventoryv1.ProductReprintRecordRequest{
		WarehouseId: warehouse, Items: items,
	}))
	if err != nil {
		t.Fatalf("ProductReprintRecord(%d): %v", warehouse, err)
	}

	return res.Msg
}

func printedOf(list *inventoryv1.ProductReprintListResponse) []*inventoryv1.ProductReprintPrinted {
	out := make([]*inventoryv1.ProductReprintPrinted, 0, len(list.GetItems()))
	for _, item := range list.GetItems() {
		out = append(out, &inventoryv1.ProductReprintPrinted{ProductId: item.GetProductId(), ProductCode: item.GetProductCode()})
	}

	return out
}

func (w codeEditWorld) waiting(t *testing.T, warehouse uint64) uint32 {
	t.Helper()

	res, err := w.inventory.WarehouseStockList(asWarehouseStaff(warehouse), connect.NewRequest(&inventoryv1.WarehouseStockListRequest{
		WarehouseId: warehouse,
		DataRequest: []inventoryv1.WarehouseStockListDataType{
			inventoryv1.WarehouseStockListDataType_WAREHOUSE_STOCK_LIST_DATA_TYPE_PRODUCT,
			inventoryv1.WarehouseStockListDataType_WAREHOUSE_STOCK_LIST_DATA_TYPE_STOCK,
			inventoryv1.WarehouseStockListDataType_WAREHOUSE_STOCK_LIST_DATA_TYPE_REPRINT_WAITING,
		},
		Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("WarehouseStockList(%d): %v", warehouse, err)
	}

	return res.Msg.GetReprintWaiting()
}

func tagged(t *testing.T, db *gorm.DB, product uint64) bool {
	t.Helper()

	var n int64

	err := db.Raw(`SELECT COUNT(*) FROM product_tag_links l JOIN product_tags g ON g.id = l.tag_id
		WHERE l.product_id = ? AND g.app_task = 'product.code.reprint'`, product).Scan(&n).Error
	if err != nil {
		t.Fatal(err)
	}

	return n > 0
}

func waitingAt(t *testing.T, db *gorm.DB, product uint64) []uint64 {
	t.Helper()

	var warehouses []uint64

	err := db.Raw("SELECT warehouse_id FROM product_reprint_waits WHERE product_id = ? ORDER BY warehouse_id", product).
		Scan(&warehouses).Error
	if err != nil {
		t.Fatal(err)
	}

	return warehouses
}

type labelWant struct {
	spot string
	qty  int64
}

func labelsOf(item *inventoryv1.ProductReprintItem) []labelWant {
	out := make([]labelWant, 0, len(item.GetLabels()))
	for _, l := range item.GetLabels() {
		out = append(out, labelWant{l.GetPlacementCode(), l.GetQuantity()})
	}

	return out
}

// GIVEN 3 — 2 products tagged, stock on 3 shelf spots; WHEN the warehouse reprints: 3 labels, each with its new code, its
// shelf spot and its quantity; the 2 products no longer tagged; the owning team's list filtered by the tag shows none;
// the reprint shows only tagged products.
func TestProductReprint_ThreeSpotsThreeLabelsAndTheTagComesOff(t *testing.T) {
	const warehouse uint64 = 9_000_151

	db := san_testdb.DB(t)
	w := newCodeEditWorld(db)

	team := sellingTeam(t, db, "Toko Anggrek E151", "E151-ABC")
	shoe := insertCatalogue(t, db, team, "E151-ABC-SHOE-42", "Sepatu", false)
	bag := insertCatalogue(t, db, team, "E151-ABC-TAS-01", "Tas", false)
	// Held here but never recomposed under the old code — a product of another team: never on the reprint.
	other := insertCatalogue(t, db, sellingTeam(t, db, "Toko Lain E151", "E151-OTH"), "E151-OTH-1", "Lain", false)

	a1 := rackAt(t, w.inventory, warehouse, "A-01-1")
	a2 := rackAt(t, w.inventory, warehouse, "A-01-2")
	b1 := rackAt(t, w.inventory, warehouse, "B-02-1")
	restockOnto(t, w.inventory, team, warehouse, shoe, "COPY-SHOE", spot(a1, 30), spot(a2, 24))
	restockOnto(t, w.inventory, team, warehouse, bag, "COPY-TAS", spot(b1, 12))
	restockOnto(t, w.inventory, teamOf(t, db, other), warehouse, other, "COPY-OTH", spot(b1, 5))

	if n := w.waiting(t, warehouse); n != 0 {
		t.Fatalf("before any change the entry counts %d, want 0 (hidden)", n)
	}

	w.changeCode(t, team, "E151-XYZ")

	// The entry's (N): 2 products wait here.
	if n := w.waiting(t, warehouse); n != 2 {
		t.Fatalf("Cetak ulang kode (N) = %d, want 2", n)
	}

	list := w.reprintList(t, warehouse)
	items := list.GetItems()

	if len(items) != 2 || list.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("reprint = %d items (total %d), want the 2 tagged products only", len(items), list.GetPageInfo().GetTotalItems())
	}

	// By live code: SHOE before TAS. Each with its NEW code and the old one beside it.
	if items[0].GetProductId() != shoe || items[0].GetProductCode() != "E151-XYZ-SHOE-42" || items[0].GetFormerCode() != "E151-ABC-SHOE-42" ||
		items[0].GetName() != "Sepatu" {
		t.Errorf("first = %+v, want Sepatu E151-XYZ-SHOE-42, was E151-ABC-SHOE-42", items[0])
	}

	if items[1].GetProductId() != bag || items[1].GetProductCode() != "E151-XYZ-TAS-01" || items[1].GetFormerCode() != "E151-ABC-TAS-01" {
		t.Errorf("second = %+v, want Tas E151-XYZ-TAS-01, was E151-ABC-TAS-01", items[1])
	}

	// then: 3 labels — one per shelf spot, its quantity.
	if got, want := labelsOf(items[0]), []labelWant{{"a-01-1", 30}, {"a-01-2", 24}}; !slices.Equal(got, want) {
		t.Errorf("Sepatu's labels = %v, want %v", got, want)
	}

	if got, want := labelsOf(items[1]), []labelWant{{"b-02-1", 12}}; !slices.Equal(got, want) {
		t.Errorf("Tas's labels = %v, want %v", got, want)
	}

	// The page's Cetak records what it printed.
	recorded := w.record(t, warehouse, printedOf(list)...)

	if !slices.Equal(recorded.GetClearedIds(), []uint64{shoe, bag}) || !slices.Equal(recorded.GetUntaggedIds(), []uint64{shoe, bag}) ||
		len(recorded.GetCodeChangedIds()) != 0 {
		t.Fatalf("record = %+v, want both cleared and untagged", recorded)
	}

	// then: 2 products no longer tagged need_reprint_code.
	for _, id := range []uint64{shoe, bag} {
		if tagged(t, db, id) || len(waitingAt(t, db, id)) != 0 {
			t.Errorf("product %d still tagged %v / waits at %v, want neither", id, tagged(t, db, id), waitingAt(t, db, id))
		}
	}

	// then: the owning team's Products list filtered by need_reprint_code shows none.
	listed, err := w.products.ProductList(asOwnerOf(team), connect.NewRequest(&productv1.ProductListRequest{
		TeamId: team,
		Filter: &productv1.ProductListFilter{TagIds: []uint64{w.reprintTag(t)}},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatal(err)
	}

	if ids := listed.Msg.GetIds(); len(ids) != 0 {
		t.Errorf("the owner's list filtered by need_reprint_code = %v, want none", ids)
	}

	// The reprint is empty now, and the entry hides.
	if again := w.reprintList(t, warehouse); len(again.GetItems()) != 0 || again.GetPageInfo().GetTotalItems() != 0 {
		t.Errorf("reprint after the print = %+v, want empty", again)
	}

	if n := w.waiting(t, warehouse); n != 0 {
		t.Errorf("Cetak ulang kode (N) after the print = %d, want 0", n)
	}
}

// GIVEN 4 — 1 product tagged, stock in 2 warehouses, only 1 has printed: the product is still tagged, and the other
// warehouse still sees it in its reprint; the one that printed no longer does (scope141 ⚠5). The other's print takes
// the tag off.
func TestProductReprint_OneOfTwoWarehousesPrintedTheTagStays(t *testing.T) {
	const (
		pusat  uint64 = 9_000_161
		cabang uint64 = 9_000_162
	)

	db := san_testdb.DB(t)
	w := newCodeEditWorld(db)

	team := sellingTeam(t, db, "Toko Anggrek E161", "E161-ABC")
	oil := insertCatalogue(t, db, team, "E161-ABC-MINYAK", "Minyak", false)

	restockOnto(t, w.inventory, team, pusat, oil, "COPY", spot(rackAt(t, w.inventory, pusat, "A-01-1"), 30))
	restockOnto(t, w.inventory, team, cabang, oil, "COPY", spot(rackAt(t, w.inventory, cabang, "C-01-1"), 25))

	w.changeCode(t, team, "E161-XYZ")

	pusatList := w.reprintList(t, pusat)
	recorded := w.record(t, pusat, printedOf(pusatList)...)

	if !slices.Equal(recorded.GetClearedIds(), []uint64{oil}) || len(recorded.GetUntaggedIds()) != 0 {
		t.Fatalf("Pusat's record = %+v, want cleared, NOT untagged (Cabang waits)", recorded)
	}

	// then: product still tagged need_reprint_code.
	if !tagged(t, db, oil) || !slices.Equal(waitingAt(t, db, oil), []uint64{cabang}) {
		t.Fatalf("tagged %v, waits at %v — want still tagged, Cabang waiting", tagged(t, db, oil), waitingAt(t, db, oil))
	}

	// then: other warehouse still sees it in its reprint — its own shelf; the one that printed sees nothing.
	cabangList := w.reprintList(t, cabang)
	if len(cabangList.GetItems()) != 1 || !slices.Equal(labelsOf(cabangList.GetItems()[0]), []labelWant{{"c-01-1", 25}}) {
		t.Errorf("Cabang's reprint = %+v, want Minyak on c-01-1 (25)", cabangList.GetItems())
	}

	if len(w.reprintList(t, pusat).GetItems()) != 0 || w.waiting(t, pusat) != 0 || w.waiting(t, cabang) != 1 {
		t.Errorf("Pusat still lists it, or the counts are off (Pusat %d, Cabang %d)", w.waiting(t, pusat), w.waiting(t, cabang))
	}

	// The last holding warehouse prints: the tag comes off.
	last := w.record(t, cabang, printedOf(cabangList)...)
	if !slices.Equal(last.GetUntaggedIds(), []uint64{oil}) || tagged(t, db, oil) {
		t.Errorf("Cabang's record = %+v, tagged %v — want the tag off", last, tagged(t, db, oil))
	}
}

// A CODE CHANGED AGAIN since the page read it is NOT cleared by the print of the older code — answered, so the page
// re-reads; the warehouse still waits, the tag stays, and the list then names the newest code with the one before it.
func TestProductReprint_ACodeChangedSinceTheReadIsNotCleared(t *testing.T) {
	const warehouse uint64 = 9_000_171

	db := san_testdb.DB(t)
	w := newCodeEditWorld(db)

	team := sellingTeam(t, db, "Toko E171", "E171-ABC")
	shoe := insertCatalogue(t, db, team, "E171-ABC-SHOE", "Sepatu", false)
	restockOnto(t, w.inventory, team, warehouse, shoe, "COPY", spot(rackAt(t, w.inventory, warehouse, "A-1"), 3))

	w.changeCode(t, team, "E171-XYZ")
	read := w.reprintList(t, warehouse)

	// Another change lands between the page's read and its Cetak.
	w.changeCode(t, team, "E171-QWE")

	recorded := w.record(t, warehouse, printedOf(read)...)
	if !slices.Equal(recorded.GetCodeChangedIds(), []uint64{shoe}) || len(recorded.GetClearedIds()) != 0 || len(recorded.GetUntaggedIds()) != 0 {
		t.Fatalf("record of the old code = %+v, want code_changed only", recorded)
	}

	if !tagged(t, db, shoe) || !slices.Equal(waitingAt(t, db, shoe), []uint64{warehouse}) {
		t.Fatalf("tagged %v, waits at %v — want still tagged and waiting here", tagged(t, db, shoe), waitingAt(t, db, shoe))
	}

	again := w.reprintList(t, warehouse).GetItems()
	if len(again) != 1 || again[0].GetProductCode() != "E171-QWE-SHOE" || again[0].GetFormerCode() != "E171-XYZ-SHOE" {
		t.Errorf("the re-read = %+v, want E171-QWE-SHOE, was E171-XYZ-SHOE", again)
	}
}

// IDEMPOTENT — the same print recorded twice changes nothing the second time and is not refused. A warehouse's record
// never clears ANOTHER warehouse's wait (it names only its own, the scope).
func TestProductReprint_ASecondRecordChangesNothingAndAnotherWarehouseClearsNothing(t *testing.T) {
	const (
		warehouse uint64 = 9_000_181
		stranger  uint64 = 9_000_182
	)

	db := san_testdb.DB(t)
	w := newCodeEditWorld(db)

	team := sellingTeam(t, db, "Toko E181", "E181-ABC")
	shoe := insertCatalogue(t, db, team, "E181-ABC-SHOE", "Sepatu", false)
	bag := insertCatalogue(t, db, team, "E181-ABC-TAS", "Tas", false)
	restockOnto(t, w.inventory, team, warehouse, shoe, "COPY", spot(rackAt(t, w.inventory, warehouse, "A-1"), 3))
	restockOnto(t, w.inventory, team, warehouse, bag, "COPY", spot(rackAt(t, w.inventory, warehouse, "A-2"), 2))

	w.changeCode(t, team, "E181-XYZ")

	// A warehouse holding none of it records the same codes: nothing of the other's is touched.
	foreign := w.record(t, stranger, &inventoryv1.ProductReprintPrinted{ProductId: shoe, ProductCode: "E181-XYZ-SHOE"})
	if len(foreign.GetClearedIds()) != 0 || len(foreign.GetUntaggedIds()) != 0 || !tagged(t, db, shoe) {
		t.Fatalf("a stranger's record = %+v, tagged %v — want nothing cleared, the tag on", foreign, tagged(t, db, shoe))
	}

	list := w.reprintList(t, warehouse)
	first := w.record(t, warehouse, printedOf(list)...)
	second := w.record(t, warehouse, printedOf(list)...)

	if len(first.GetClearedIds()) != 2 || len(second.GetClearedIds()) != 0 || len(second.GetUntaggedIds()) != 0 ||
		len(second.GetCodeChangedIds()) != 0 {
		t.Errorf("first %+v, second %+v — want the second to change nothing", first, second)
	}

	if tagged(t, db, shoe) || tagged(t, db, bag) {
		t.Errorf("still tagged after the print")
	}
}

// ⚠6 — A TRANSFER ACCEPTED WHILE TAGGED: the units that arrive wear the old stickers, so the receiving warehouse waits
// too, in the accept's own transaction; its reprint lists the product with its own shelf. A product nobody waits for
// arrives untouched.
func TestProductReprint_ATransferAcceptedWhileTaggedAddsTheReceivingWarehouse(t *testing.T) {
	const (
		from uint64 = 9_000_191
		to   uint64 = 9_000_192
	)

	db := san_testdb.DB(t)
	w := newCodeEditWorld(db)

	team := sellingTeam(t, db, "Toko E191", "E191-ABC")
	shoe := insertCatalogue(t, db, team, "E191-ABC-SHOE", "Sepatu", false)
	restockOnto(t, w.inventory, team, from, shoe, "COPY", spot(rackAt(t, w.inventory, from, "A-1"), 10))

	w.changeCode(t, team, "E191-XYZ")

	// Made after the change, so never tagged — it travels in the same box.
	fresh := insertCatalogue(t, db, team, "E191-XYZ-BARU", "Baru", false)
	restockOnto(t, w.inventory, team, from, fresh, "COPY", spot(rackAt(t, w.inventory, from, "A-2"), 4))

	if !slices.Equal(waitingAt(t, db, shoe), []uint64{from}) {
		t.Fatalf("before the transfer shoe waits at %v, want only the sender", waitingAt(t, db, shoe))
	}

	rack := rackAt(t, w.inventory, to, "T-1")
	transfer := shipTransfer(t, w.inventory, team, from, to, map[uint64]int64{shoe: 6, fresh: 4})

	_, err := w.inventory.WarehouseTransferAccept(asWarehouseStaff(to), connect.NewRequest(&inventoryv1.WarehouseTransferAcceptRequest{
		TeamId: to, TransferId: transfer.GetId(),
		Lines: []*inventoryv1.WarehouseTransferCountedLine{
			acceptedOnto(transfer, shoe, 6, rack),
			acceptedOnto(transfer, fresh, 4, rack),
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	if !slices.Equal(waitingAt(t, db, shoe), []uint64{from, to}) || !tagged(t, db, shoe) {
		t.Errorf("after the accept shoe waits at %v (tagged %v), want the sender and the receiver", waitingAt(t, db, shoe), tagged(t, db, shoe))
	}

	if len(waitingAt(t, db, fresh)) != 0 || tagged(t, db, fresh) {
		t.Errorf("the untagged product waits at %v, want nowhere", waitingAt(t, db, fresh))
	}

	list := w.reprintList(t, to).GetItems()
	if len(list) != 1 || list[0].GetProductId() != shoe || !slices.Equal(labelsOf(list[0]), []labelWant{{"t-1", 6}}) {
		t.Errorf("the receiver's reprint = %+v, want Sepatu on t-1 (6)", list)
	}
}

// ⚠1 — CETAK LABEL PRINTS THE LIVE CODE: a restock's labels carry the product's code as it is now, never the code its
// line was written with — before a team code change and after it, through both reads the label page uses.
func TestRestockLabels_PrintTheProductsLiveCode(t *testing.T) {
	const warehouse uint64 = 9_000_201

	db := san_testdb.DB(t)
	w := newCodeEditWorld(db)

	team := sellingTeam(t, db, "Toko E201", "E201-ABC")
	shoe := insertCatalogue(t, db, team, "E201-ABC-SHOE", "Sepatu", false)
	restock := restockOnto(t, w.inventory, team, warehouse, shoe, "WRITTEN-CODE", spot(rackAt(t, w.inventory, warehouse, "A-1"), 3))

	codes := func() (single, byIds string) {
		one, err := w.inventory.RestockRequestLabels(asWarehouseStaff(warehouse), connect.NewRequest(&inventoryv1.RestockRequestLabelsRequest{
			TeamId: warehouse, RequestId: restock,
		}))
		if err != nil {
			t.Fatal(err)
		}

		many, err := w.inventory.RestockRequestByIds(asWarehouseStaff(warehouse), connect.NewRequest(&inventoryv1.RestockRequestByIdsRequest{
			TeamId: warehouse, Filter: &inventoryv1.RestockRequestByIdsFilter{Ids: []uint64{restock}},
			DataRequest: []inventoryv1.RestockRequestByIdsDataType{inventoryv1.RestockRequestByIdsDataType_RESTOCK_REQUEST_BY_IDS_DATA_TYPE_LABELS},
		}))
		if err != nil {
			t.Fatal(err)
		}

		labels := one.Msg.GetLabels()
		set := many.Msg.GetItems()[restock].GetItems()[0].GetLabels().GetLabels()

		if len(labels) != 1 || len(set) != 1 {
			t.Fatalf("labels = %d / %d, want 1 each", len(labels), len(set))
		}

		return labels[0].GetProductCode(), set[0].GetProductCode()
	}

	if one, many := codes(); one != "E201-ABC-SHOE" || many != "E201-ABC-SHOE" {
		t.Errorf("before the change the labels print %q / %q, want the live E201-ABC-SHOE (never the line's WRITTEN-CODE)", one, many)
	}

	w.changeCode(t, team, "E201-XYZ")

	if one, many := codes(); one != "E201-XYZ-SHOE" || many != "E201-XYZ-SHOE" {
		t.Errorf("after the change the labels print %q / %q, want the live E201-XYZ-SHOE", one, many)
	}

	// The restock line itself keeps the code it was written with (🔄 past lines keep their code).
	var line string

	err := db.Raw("SELECT product_code FROM restock_items WHERE restock_id = ?", restock).Scan(&line).Error
	if err != nil || line != "WRITTEN-CODE" {
		t.Errorf("the restock line reads %q (%v), want WRITTEN-CODE untouched", line, err)
	}
}

// WHO MAY: the read — the warehouse's roles, Root and the Administrator, and (a read) the monitor and an agent; the
// record — the same roles, never marked side-effect free, so a monitor records nothing.
func TestProductReprint_Policies(t *testing.T) {
	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	}
	slices.Sort(want)

	for _, c := range []struct {
		request, method string
		aRead           bool
	}{
		{"warehouse.inventory.v1.ProductReprintListRequest", "warehouse.inventory.v1.InventoryService.ProductReprintList", true},
		{"warehouse.inventory.v1.ProductReprintRecordRequest", "warehouse.inventory.v1.InventoryService.ProductReprintRecord", false},
	} {
		desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(c.request))
		if err != nil {
			t.Fatalf("%s: %v", c.request, err)
		}

		policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
		if policy == nil {
			t.Fatalf("%s has no policy", c.request)
		}

		got := slices.Clone(policy.GetRoles())
		slices.Sort(got)

		if !slices.Equal(got, want) {
			t.Errorf("%s roles = %v, want exactly %v", c.request, got, want)
		}

		method, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(c.method))
		if err != nil {
			t.Fatalf("%s: %v", c.method, err)
		}

		opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
		if read := opts.GetIdempotencyLevel() == descriptorpb.MethodOptions_NO_SIDE_EFFECTS; read != c.aRead {
			t.Errorf("%s marked a read = %v, want %v", c.method, read, c.aRead)
		}
	}
}

// A WAREHOUSE SEES NO SELLER MONEY — the reprint's answer carries exactly the product's id, live code, name, former code
// and its labels (a spot and its quantity): no price, no cost, no owner's figure.
func TestProductReprint_TheAnswerCarriesNoMoney(t *testing.T) {
	for name, want := range map[string][]string{
		"warehouse.inventory.v1.ProductReprintItem":  {"product_id", "product_code", "name", "former_code", "labels"},
		"warehouse.inventory.v1.ProductReprintLabel": {"placement_id", "placement_code", "quantity"},
	} {
		desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(name))
		if err != nil {
			t.Fatal(err)
		}

		fields := desc.(protoreflect.MessageDescriptor).Fields()
		got := make([]string, 0, fields.Len())

		for i := range fields.Len() {
			got = append(got, string(fields.Get(i).Name()))
		}

		if !slices.Equal(got, want) {
			t.Errorf("%s fields = %v, want exactly %v", name, got, want)
		}
	}
}

// teamOf is the product's owning team.
func teamOf(t *testing.T, db *gorm.DB, product uint64) uint64 {
	t.Helper()

	var team uint64

	err := db.Raw("SELECT team_id FROM products WHERE id = ?", product).Scan(&team).Error
	if err != nil {
		t.Fatal(err)
	}

	return team
}

// shipTransfer opens a transfer of the team's units from → to, and processes and ships it, as each warehouse's staff.
func shipTransfer(t *testing.T, inventory *inventory_v1.Service, team, from, to uint64, units map[uint64]int64) *inventoryv1.WarehouseTransfer {
	t.Helper()

	ids := make([]uint64, 0, len(units))
	for id := range units {
		ids = append(ids, id)
	}

	slices.Sort(ids)

	lines := make([]*inventoryv1.WarehouseTransferLine, 0, len(ids))
	for _, id := range ids {
		lines = append(lines, &inventoryv1.WarehouseTransferLine{ProductId: id, Count: units[id]})
	}

	created, err := inventory.WarehouseTransferCreate(asOwnerOf(team), connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
		TeamId: team, FromWarehouseId: from, ToWarehouseId: to, Lines: lines, Note: "reprint",
	}))
	if err != nil {
		t.Fatalf("transfer create: %v", err)
	}

	id := created.Msg.GetTransfer().GetId()

	_, err = inventory.WarehouseTransferProcess(asWarehouseStaff(from), connect.NewRequest(&inventoryv1.WarehouseTransferProcessRequest{TeamId: from, TransferId: id}))
	if err != nil {
		t.Fatalf("transfer process: %v", err)
	}

	_, err = inventory.WarehouseTransferShip(asWarehouseStaff(from), connect.NewRequest(&inventoryv1.WarehouseTransferShipRequest{TeamId: from, TransferId: id}))
	if err != nil {
		t.Fatalf("transfer ship: %v", err)
	}

	return created.Msg.GetTransfer()
}

// acceptedOnto is the receiver's count of one line: every unit arrived whole, all on one spot.
func acceptedOnto(tr *inventoryv1.WarehouseTransfer, product uint64, units int64, rack uint64) *inventoryv1.WarehouseTransferCountedLine {
	for _, item := range tr.GetItems() {
		if item.GetProductId() == product {
			return &inventoryv1.WarehouseTransferCountedLine{
				ItemId: item.GetId(), ArrivedCount: units,
				Placements: []*inventoryv1.WarehouseTransferPlacement{{PlacementId: rack, Quantity: units}},
			}
		}
	}

	return nil
}
