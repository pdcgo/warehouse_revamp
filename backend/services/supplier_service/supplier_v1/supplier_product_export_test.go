package supplier_v1_test

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1/supplierv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// THE PRODUK TAB AS A FILE (SupplierProductExport — each-supplier-tab-exports-its-own-table, on
// a-report-export-is-the-whole-view-as-a-file).

// runProductExport runs SupplierProductExport end to end; a stream error is returned, not fatal.
func runProductExport(t *testing.T, svc *supplier_v1.Service, store *fakeExports, req *supplierv1.SupplierProductExportRequest) (exportFile, error) {
	t.Helper()

	client := supplierv1connect.NewSupplierChannelServiceClient(http.DefaultClient, serve(t, svc))

	stream, err := client.SupplierProductExport(context.Background(), connect.NewRequest(req))
	if err != nil {
		return exportFile{}, err
	}
	defer func() { _ = stream.Close() }()

	var lines []progressLine
	for stream.Receive() {
		m := stream.Msg()
		lines = append(lines, progressLine{m.GetMessage(), m.GetDone(), m.GetTotal(), m.GetDownloadUrl(), m.GetFilename()})
	}

	if stream.Err() != nil {
		return exportFile{}, stream.Err()
	}

	return readFile(t, store, lines), nil
}

// productExportTab is a Produk tab whose service also stores files.
func productExportTab(t *testing.T) (productTab, *fakeExports) {
	t.Helper()

	tab := newProductTab(t)
	store := &fakeExports{teams: map[uint64]string{sellingA: "Toko Melati", sellingB: "Toko Kenanga"}}
	tab.svc = supplier_v1.NewService(tab.db, nil, nil, tab.goods, store, tab.catalog)

	return tab, store
}

// listedProducts is every row the tab pages through with this filter — page after page of SupplierProductList, as the
// screen turns them — each as "product name @ store name", in order.
func listedProducts(t *testing.T, tab productTab, filter *supplierv1.SupplierProductListFilter) []string {
	t.Helper()

	var out []string

	for n := uint32(1); ; n++ {
		rows, total := tab.list(t, sellingA, filter, n, 50)
		for _, row := range rows {
			out = append(out, row.GetProductName()+" @ "+row.GetChannelName())
		}

		if uint64(n)*50 >= total {
			return out
		}
	}
}

// The file holds EXACTLY the rows the tab holds with the same filter, every page of them, in the tab's order — 230
// matching links, more than one step of the export and five pages of the list — and each step asks product_service and
// inventory once.
func TestSupplierProductExport_TheFileIsTheListsRowsAcrossPages(t *testing.T) {
	tab, store := productExportTab(t)

	sumber := insertSupplier(t, tab.db, sellingB, "PT Sumber Makmur")
	other := insertSupplier(t, tab.db, sellingB, "CV Lain")
	shopee := insertChannel(t, tab.db, sumber.ID, "shopee", "Grosir Sumber")
	wa := insertChannel(t, tab.db, sumber.ID, "other", "Pesan WA")
	closed := insertChannel(t, tab.db, sumber.ID, "lazada", "Grosir Tutup")
	softDelete(t, tab.db, &supplier_service_models.SupplierChannel{}, closed.ID)

	for i := range 230 {
		product := uint64(10_000 + i)
		tab.catalog.cards[product] = supplier_v1.ProductCard{Name: fmt.Sprintf("Kain %03d", i), Code: fmt.Sprintf("KN-%03d", i)}

		store := shopee.ID
		if i%4 == 0 {
			store = wa.ID // searched in by its product's name, not its store's
		}

		insertLink(t, tab.db, sumber.ID, store, product, sellingA, 300, i%40)
	}

	// Narrowed out: another team's product, a product the search misses, a deleted store's, another supplier's.
	tab.catalog.cards[20_001] = supplier_v1.ProductCard{Name: "Kain Kenanga", Code: "KK-1"}
	tab.catalog.cards[20_002] = supplier_v1.ProductCard{Name: "Benang", Code: "BN-1"}
	tab.catalog.cards[20_003] = supplier_v1.ProductCard{Name: "Kain Tutup", Code: "KT-1"}
	tab.catalog.cards[20_004] = supplier_v1.ProductCard{Name: "Kain Lain", Code: "KL-1"}
	insertLink(t, tab.db, sumber.ID, shopee.ID, 20_001, sellingB, 5, 1)
	insertLink(t, tab.db, sumber.ID, wa.ID, 20_002, sellingA, 5, 1)
	insertLink(t, tab.db, sumber.ID, closed.ID, 20_003, sellingA, 5, 1)
	insertLink(t, tab.db, other.ID, 0, 20_004, sellingA, 5, 1)

	filter := &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, Q: "kain", ProductTeamId: sellingA}

	// Another team's supplier: reads cross teams (another-team-sees-everything-of-a-supplier) — the caller is A.
	tab.catalog.cardCalls, tab.goods.asked = nil, nil

	file, err := runProductExport(t, tab.svc, store, &supplierv1.SupplierProductExportRequest{TeamId: sellingA, Filter: filter})
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	steps := len(tab.goods.asked)
	if steps != 2 || len(tab.catalog.cardCalls) != 2 {
		t.Fatalf("230 rows asked inventory %d times and product_service %d — want once each per step of 200", steps, len(tab.catalog.cardCalls))
	}

	names := file.column(t, "Produk", "Produk")
	stores := file.column(t, "Produk", "Toko pemasok")

	got := make([]string, 0, len(names))
	for i := range names {
		got = append(got, names[i]+" @ "+stores[i])
	}

	want := listedProducts(t, tab, filter)
	if len(want) != 230 || !slices.Equal(got, want) {
		t.Fatalf("the file holds %d rows, the list %d — they must be the same rows in the same order", len(got), len(want))
	}

	last := file.last(t)
	if last.done != 230 || last.total != 230 || last.url == "" || !strings.HasPrefix(last.name, "produk-pemasok-") ||
		!strings.HasSuffix(last.name, ".xlsx") {
		t.Fatalf("last message = %+v", last)
	}

	// Progress on the way: the count first, then a step of 200 before the end.
	if file.messages[0].total != 230 || file.messages[0].done != 0 || !slices.ContainsFunc(file.messages, func(p progressLine) bool {
		return p.done == 200
	}) {
		t.Fatalf("progress = %+v", file.messages)
	}

	// Stored under the CALLER's team.
	if store.teamID != sellingA {
		t.Fatalf("stored under team %d, want the caller's %d", store.teamID, sellingA)
	}
}

// The columns are the tab's, in Indonesian: the product and its SKU, whose, the store and its type (empty for a line that
// named none, the tab's "—"), the last restock and the first as Jakarta days, the units as numbers beside the last
// order's day; a product none of whose goods arrived reads empty figure cells. One team picked, Tim goes.
func TestSupplierProductExport_ColumnsAndFigures(t *testing.T) {
	tab, store := productExportTab(t)

	sumber := insertSupplier(t, tab.db, sellingA, "PT Sumber Makmur")
	shopee := insertChannel(t, tab.db, sumber.ID, "shopee", "Sumber Official")

	tab.catalog.cards[801] = supplier_v1.ProductCard{Name: "Kain Katun", Code: "KTN-01"}
	tab.catalog.cards[802] = supplier_v1.ProductCard{Name: "Benang", Code: "BNG-02"}

	// 23:30 UTC is the NEXT Jakarta day.
	lastOrder := time.Date(2026, 11, 6, 23, 30, 0, 0, time.UTC).Unix()
	tab.goods.figures[supplier_v1.StoreProduct{StoreID: shopee.ID, ProductID: 801}] = supplier_v1.StoreGoods{
		Sold: 412, Orders: 30, LastOrderUnix: lastOrder, Ready: 37,
	}

	insertLink(t, tab.db, sumber.ID, shopee.ID, 801, sellingA, 30, 2)
	insertLink(t, tab.db, sumber.ID, 0, 802, sellingB, 9, 9)

	file, err := runProductExport(t, tab.svc, store, &supplierv1.SupplierProductExportRequest{
		TeamId: sellingB, Filter: &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID},
	})
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	rows := file.rows["Produk"]
	header := []string{"Produk", "SKU", "Tim", "Toko pemasok", "Jenis toko", "Terakhir dibeli", "Pertama dibeli", "Terjual", "Pesanan terakhir", "Siap"}

	if !slices.Equal(rows[0], header) || len(rows) != 3 {
		t.Fatalf("header %v, %d rows", rows[0], len(rows))
	}

	day := func(daysAgo int) string {
		return spBase.AddDate(0, 0, -daysAgo).In(time.FixedZone("WIB", 7*3600)).Format("2006-01-02")
	}

	want := []string{"Kain Katun", "KTN-01", "Toko Melati", "Sumber Official", "Shopee", day(2), day(30), "412", "2026-11-07", "37"}
	if !slices.Equal(rows[1], want) {
		t.Fatalf("a product with goods = %v, want %v", rows[1], want)
	}

	// No store, no goods: the store and figure cells are empty — trailing empty cells are not stored.
	want = []string{"Benang", "BNG-02", "Toko Kenanga", "", "", day(9), day(9)}
	if !slices.Equal(rows[2], want) {
		t.Fatalf("a store-less product with no goods = %v, want %v", rows[2], want)
	}

	// One team picked: its products only, and no Tim column.
	file, err = runProductExport(t, tab.svc, store, &supplierv1.SupplierProductExportRequest{
		TeamId: sellingB, Filter: &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, ProductTeamId: sellingA},
	})
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	rows = file.rows["Produk"]
	if slices.Contains(rows[0], "Tim") || len(rows) != 2 || rows[1][0] != "Kain Katun" {
		t.Fatalf("one team picked = %v", rows)
	}
}

// Who may export: a deleted supplier is NotFound, as the list answers it; a warehouse role is refused at the door; it is
// not a read. With no store configured, it says so — never a fake file.
func TestSupplierProductExport_Scope(t *testing.T) {
	tab, store := productExportTab(t)

	gone := insertSupplier(t, tab.db, sellingA, "Tutup")
	insertLink(t, tab.db, gone.ID, 0, 801, sellingA, 5, 1)
	softDelete(t, tab.db, &supplier_service_models.Supplier{}, gone.ID)

	_, err := runProductExport(t, tab.svc, store, &supplierv1.SupplierProductExportRequest{
		TeamId: sellingA, Filter: &supplierv1.SupplierProductListFilter{SupplierId: gone.ID},
	})
	if connect.CodeOf(err) != connect.CodeNotFound || store.content != nil {
		t.Fatalf("a deleted supplier: err %v, stored %d bytes — want NotFound and no file", err, len(store.content))
	}

	assertExportPolicy(t, "warehouse.supplier.v1.SupplierProductExportRequest",
		"warehouse.supplier.v1.SupplierChannelService.SupplierProductExport")

	melati := insertSupplier(t, tab.db, sellingA, "Melati")

	_, err = runProductExport(t, supplier_v1.NewService(tab.db, nil, nil, tab.goods, nil, tab.catalog), &fakeExports{},
		&supplierv1.SupplierProductExportRequest{TeamId: sellingA, Filter: &supplierv1.SupplierProductListFilter{SupplierId: melati.ID}})
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("no export store: err = %v, want Unimplemented", err)
	}
}

// THE FILE FOLLOWS THE CHIP (each-supplier-tab-exports-its-own-table: "the tab's table as narrowed … and the Gudang
// terkait chip"): under warehouse 1 the file holds exactly the rows the tab holds under it, across pages, each with that
// warehouse's figures — every step reads them for the chip's warehouse.
func TestSupplierProductExport_TheFileFollowsTheWarehouseChip(t *testing.T) {
	tab, store := productExportTab(t)

	sumber := insertSupplier(t, tab.db, sellingA, "PT Sumber Makmur")
	shopee := insertChannel(t, tab.db, sumber.ID, "shopee", "Grosir Sumber")

	tab.goods.pairsAt = map[uint64][]supplier_v1.StoreProduct{}
	tab.goods.figuresAt = map[uint64]map[supplier_v1.StoreProduct]supplier_v1.StoreGoods{chipWarehouse1: {}}

	for i := range 260 {
		product := uint64(30_000 + i)
		tab.catalog.cards[product] = supplier_v1.ProductCard{Name: fmt.Sprintf("Kain %03d", i), Code: fmt.Sprintf("KN-%03d", i)}

		storeID := shopee.ID
		if i%5 == 0 {
			storeID = 0 // bought at a stall
		}

		insertLink(t, tab.db, sumber.ID, storeID, product, sellingA, 300, i%40)

		// Two in three were received at warehouse 1 — 174 rows, more than one step of the file.
		if i%3 != 2 {
			pair := supplier_v1.StoreProduct{StoreID: storeID, ProductID: product}
			tab.goods.pairsAt[chipWarehouse1] = append(tab.goods.pairsAt[chipWarehouse1], pair)
			tab.goods.figuresAt[chipWarehouse1][pair] = supplier_v1.StoreGoods{Sold: int64(i), Ready: 1}
		}
	}

	filter := &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, WarehouseId: chipWarehouse1}
	tab.goods.askedAt = nil

	file, err := runProductExport(t, tab.svc, store, &supplierv1.SupplierProductExportRequest{TeamId: sellingA, Filter: filter})
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	if !slices.Equal(tab.goods.askedAt, []uint64{chipWarehouse1}) {
		t.Fatalf("the file read its figures under %v — want the chip's warehouse, once for its one step", tab.goods.askedAt)
	}

	names := file.column(t, "Produk", "Produk")
	stores := file.column(t, "Produk", "Toko pemasok")

	got := make([]string, 0, len(names))
	for i := range names {
		got = append(got, names[i]+" @ "+stores[i])
	}

	want := listedProducts(t, tab, filter)
	if len(want) != 174 || !slices.Equal(got, want) {
		t.Fatalf("the file holds %d rows, the tab under the chip %d — want the same 174 rows in the same order", len(got), len(want))
	}

	// Every row carries the chip's figures: 1 ready each.
	for i, ready := range file.column(t, "Produk", "Siap") {
		if ready != "1" {
			t.Fatalf("row %d reads %q ready — want warehouse 1's 1", i, ready)
		}
	}

	last := file.last(t)
	if last.done != 174 || last.total != 174 {
		t.Fatalf("last message = %+v, want 174 of 174", last)
	}
}
