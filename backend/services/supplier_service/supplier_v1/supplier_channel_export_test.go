package supplier_v1_test

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// THE TOKO TAB AS A FILE (each-supplier-tab-exports-its-own-table, on one-export-is-the-list-as-a-file).

// listedStores is every store the tab pages through with this filter — page after page of SupplierChannelList, as the
// screen turns them — by name, in order.
func listedStores(t *testing.T, svc *supplier_v1.Service, filter *supplierv1.SupplierChannelListFilter) []string {
	t.Helper()

	var names []string

	for n := uint32(1); ; n++ {
		resp, err := svc.SupplierChannelList(context.Background(), connect.NewRequest(&supplierv1.SupplierChannelListRequest{
			TeamId: sellingA, Filter: filter, Page: page(n, 50),
			DataRequest: []supplierv1.SupplierChannelListDataType{supplierv1.SupplierChannelListDataType_SUPPLIER_CHANNEL_LIST_DATA_TYPE_SUPPLIER_CHANNEL},
		}))
		if err != nil {
			t.Fatalf("SupplierChannelList page %d: %v", n, err)
		}

		var byID map[uint64]*supplierv1.SupplierChannel
		for _, item := range resp.Msg.GetItems() {
			if m := item.GetSupplierChannel(); m != nil {
				byID = m.GetMapData()
			}
		}

		for _, id := range resp.Msg.GetIds() {
			names = append(names, byID[id].GetName())
		}

		if n >= resp.Msg.GetPageInfo().GetTotalPage() {
			return names
		}
	}
}

// The file holds EXACTLY the rows the tab holds with the same filter, every page of them, in the tab's order — 230
// matching stores, more than one step of the export and five pages of the list.
func TestSupplierChannelExport_TheFileIsTheListsRowsAcrossPages(t *testing.T) {
	db := san_testdb.DB(t)
	store := &fakeExports{}
	svc := exportService(db, &fakeGoods{}, store)

	melati := insertSupplier(t, db, sellingB, "Melati")
	other := insertSupplier(t, db, sellingB, "Lain")

	for i := range 230 {
		insertChannel(t, db, melati.ID, "shopee", fmt.Sprintf("Grosir Melati %03d", i))
	}
	// Narrowed out: another type, another word, a deleted store, another supplier's store.
	insertChannel(t, db, melati.ID, "tokopedia", "Grosir Melati Tokopedia")
	insertChannel(t, db, melati.ID, "shopee", "Butik Kain")
	gone := insertChannel(t, db, melati.ID, "shopee", "Grosir Melati Tutup")
	softDelete(t, db, &supplier_service_models.SupplierChannel{}, gone.ID)
	insertChannel(t, db, other.ID, "shopee", "Grosir Melati Palsu")

	filter := &supplierv1.SupplierChannelListFilter{
		SupplierId: melati.ID, Q: "grosir", ChannelType: marketplacev1.Marketplace_MARKETPLACE_SHOPEE,
	}

	// Another team's supplier: reads cross teams (another-team-sees-everything-of-a-supplier) — the caller is A.
	file, err := runChannelExport(t, svc, store, &supplierv1.SupplierChannelExportRequest{TeamId: sellingA, Filter: filter})
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	want := listedStores(t, svc, filter)
	got := file.column(t, "Toko", "Toko pemasok")

	if len(want) != 230 || !slices.Equal(got, want) {
		t.Fatalf("the file holds %d stores, the list %d — they must be the same rows in the same order", len(got), len(want))
	}

	last := file.last(t)
	if last.done != 230 || last.total != 230 || last.url == "" || !strings.HasPrefix(last.name, "toko-pemasok-") ||
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

// The columns are the tab's, in Indonesian, the figures as numbers beside their Jakarta days; a store none of whose goods
// arrived reads empty cells, as the tab's dash.
func TestSupplierChannelExport_ColumnsAndFigures(t *testing.T) {
	db := san_testdb.DB(t)
	store := &fakeExports{}

	melati := insertSupplier(t, db, sellingA, "Melati")
	sold := insertChannel(t, db, melati.ID, "tiktok", "Melati Official")
	quiet := insertChannel(t, db, melati.ID, "other", "Melati WA")

	err := db.Model(&supplier_service_models.SupplierChannel{}).Where("id = ?", sold.ID).
		Updates(map[string]any{"uri": "https://shop.example/melati", "description": "0812 grosir"}).Error
	if err != nil {
		t.Fatal(err)
	}

	// 23:30 UTC is the NEXT Jakarta day.
	lastOrder := time.Date(2026, 11, 6, 23, 30, 0, 0, time.UTC).Unix()
	lastRestock := time.Date(2026, 10, 20, 3, 0, 0, 0, time.UTC).Unix()

	goods := &fakeGoods{stores: map[uint64]supplier_v1.StoreGoods{
		sold.ID: {Sold: 1074, Ready: 43, LastOrderUnix: lastOrder, LastRestockUnix: lastRestock},
	}}

	file, err := runChannelExport(t, exportService(db, goods, store), store, &supplierv1.SupplierChannelExportRequest{
		TeamId: sellingA, Filter: &supplierv1.SupplierChannelListFilter{SupplierId: melati.ID},
	})
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	rows := file.rows["Toko"]
	wantHeader := []string{"Toko pemasok", "Jenis toko", "Tautan", "Deskripsi", "Terjual", "Pesanan terakhir", "Siap", "Restok terakhir"}

	if len(file.sheets) != 1 || !slices.Equal(rows[0], wantHeader) {
		t.Fatalf("sheets %v, header %v — want one sheet headed %v", file.sheets, rows[0], wantHeader)
	}

	// The newest store first, as the list.
	if len(rows) != 3 {
		t.Fatalf("rows = %v", rows)
	}

	if want := []string{"Melati WA", "Other"}; !slices.Equal(rows[1], want) {
		t.Fatalf("a store with no goods = %v, want %v and empty figure cells", rows[1], want)
	}

	want := []string{"Melati Official", "TikTok", "https://shop.example/melati", "0812 grosir", "1074", "2026-11-07", "43", "2026-10-20"}
	if !slices.Equal(rows[2], want) {
		t.Fatalf("a store with goods = %v, want %v", rows[2], want)
	}

	_ = quiet
}

// Who may export, and what is never in the file: a deleted supplier is NotFound, as the list answers it; a warehouse
// role is refused at the door (it reads the stores but not their figures).
func TestSupplierChannelExport_Scope(t *testing.T) {
	db := san_testdb.DB(t)
	store := &fakeExports{}
	svc := exportService(db, &fakeGoods{}, store)

	gone := insertSupplier(t, db, sellingA, "Tutup")
	insertChannel(t, db, gone.ID, "shopee", "Tutup Store")
	softDelete(t, db, &supplier_service_models.Supplier{}, gone.ID)

	_, err := runChannelExport(t, svc, store, &supplierv1.SupplierChannelExportRequest{
		TeamId: sellingA, Filter: &supplierv1.SupplierChannelListFilter{SupplierId: gone.ID},
	})
	if connect.CodeOf(err) != connect.CodeNotFound || store.content != nil {
		t.Fatalf("a deleted supplier: err %v, stored %d bytes — want NotFound and no file", err, len(store.content))
	}

	assertExportPolicy(t, "warehouse.supplier.v1.SupplierChannelExportRequest",
		"warehouse.supplier.v1.SupplierChannelService.SupplierChannelExport")
}

// With no store configured the RPC says so, never a fake file.
func TestSupplierChannelExport_NoStoreIsUnimplemented(t *testing.T) {
	db := san_testdb.DB(t)
	svc := supplier_v1.NewService(db, nil, nil, &fakeGoods{}, nil)

	melati := insertSupplier(t, db, sellingA, "Melati")

	_, err := runChannelExport(t, svc, &fakeExports{}, &supplierv1.SupplierChannelExportRequest{
		TeamId: sellingA, Filter: &supplierv1.SupplierChannelListFilter{SupplierId: melati.ID},
	})
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("err = %v, want Unimplemented", err)
	}
}
