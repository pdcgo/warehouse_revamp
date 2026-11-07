package supplier_v1_test

import (
	"context"
	"slices"
	"strconv"
	"strings"
	"testing"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// THE STATISTIK TAB AS A FILE (each-supplier-tab-exports-its-own-table): the view on screen, Per Periode or Per Produk.

var figureHeader = []string{
	"Direstok (unit)", "Direstok (Rp)",
	"Penjualan (unit)", "Penjualan (Rp)",
	"Hilang di pengiriman (unit)", "Hilang di pengiriman (Rp)", "Tingkat hilang",
	"Rusak di pengiriman (unit)", "Rusak di pengiriman (Rp)", "Tingkat rusak",
}

// Per Periode at a day: every day of the window, NEWEST first, the quiet ones included — a year of them, more than one
// step of the export — each the figures the tab's own MetricData reads for it. Money exact to its fraction, a rate the
// exact share.
func TestSupplierFigureExport_PerPeriodeIsEveryPeriodOfTheWindow(t *testing.T) {
	db := san_testdb.DB(t)
	store := &fakeExports{}
	svc := exportService(db, &fakeGoods{}, store)

	melati := insertSupplier(t, db, sellingA, "Melati")

	// 3 units in, 1 broken, Rp 12.345,505 — a price with a fraction, never rounded (the-backend-never-rounds-money).
	event := accept(1, sellingA, melati.ID, "2026-10-01", line{product: 100, ordered: 3, accepted: 2, broken: 1})
	event.GetRestockAccepted().GetLines()[0].TotalPrice = 37036.515
	fold(t, svc, event)
	fold(t, svc, accept(2, sellingA, melati.ID, "2026-03-15", line{product: 100, ordered: 10, total: 100000, accepted: 10}))

	window := filters(dateRange("2025-11-01", "2026-10-31"), oneSupplier(melati.ID))

	file, err := runFigureExport(t, svc, store, &supplierv1.SupplierFigureExportRequest{
		TeamId: sellingA, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_DAILY, Filters: window,
	})
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	rows := file.rows["Per Periode"]
	if !slices.Equal(rows[0], append([]string{"Periode"}, figureHeader...)) {
		t.Fatalf("header = %v", rows[0])
	}

	periods := file.column(t, "Per Periode", "Periode")
	if len(periods) != 365 || periods[0] != "2026-10-31" || periods[364] != "2025-11-01" {
		t.Fatalf("%d periods, first %s, last %s — want 365 days, newest first", len(periods), periods[0], periods[len(periods)-1])
	}

	if last := file.last(t); last.done != 365 || last.total != 365 || !strings.HasPrefix(last.name, "statistik-pemasok-per-periode-") {
		t.Fatalf("last message = %+v", last)
	}

	// Each row is what the tab's MetricData answers for that day.
	data := fill(t, svc, &supplierv1.MetricDataRequest{
		GroupBy: analytic_basev1.GroupType_GROUP_TYPE_DAILY, Filters: window, Keys: dayKeys("2026-10-01", "2026-03-15", "2026-10-02"),
	}).GetSupplierByDay().GetItems()

	for i, day := range periods {
		m, asked := data[day]
		if !asked {
			continue
		}

		want := []string{
			day,
			strconv.FormatInt(m.GetRestockCount(), 10), strconv.FormatFloat(m.GetRestockValuation(), 'f', -1, 64),
			"0", "0",
			"0", "0", rate(m.GetShippingLostCount(), m),
			strconv.FormatInt(m.GetShippingBrokenCount(), 10), strconv.FormatFloat(m.GetShippingBrokenValuation(), 'f', -1, 64),
			rate(m.GetShippingBrokenCount(), m),
		}
		// A sheet's row ends at its last filled cell — an empty rate at the end is not read back.
		for len(want) > 0 && want[len(want)-1] == "" {
			want = want[:len(want)-1]
		}

		if !slices.Equal(rows[i+1], want) {
			t.Fatalf("row %s = %v, want %v", day, rows[i+1], want)
		}
	}

	// The exact value on the accept's day: 2 good units of 3 at Rp 12.345,505 each, the broken share 1/3.
	at := slices.Index(periods, "2026-10-01")
	if got := rows[at+1]; got[2] != "24691.01" || got[8] != "1" || !strings.HasPrefix(got[10], "0.3333") {
		t.Fatalf("2026-10-01 = %v — want Rp 24691.01 exact and a broken share of 1/3", got)
	}

	// A quiet day is a row of zeroes with no rate — nothing arrived, which has no rate.
	if got := rows[2]; got[0] != "2026-10-30" || got[1] != "0" || len(got) > 10 && got[10] != "" {
		t.Fatalf("a quiet day = %v", got)
	}
}

func rate(count int64, m *supplierv1.SupplierMetric) string {
	units := m.GetRestockCount() + m.GetShippingLostCount() + m.GetShippingBrokenCount()
	if units == 0 {
		return ""
	}

	return strconv.FormatFloat(float64(count)/float64(units), 'f', -1, 64)
}

// Per Periode at a month reads each month by its name, as the tab does (a-period-reads-as-its-grain).
func TestSupplierFigureExport_AMonthReadsAsItsName(t *testing.T) {
	db := san_testdb.DB(t)
	store := &fakeExports{}
	svc := exportService(db, &fakeGoods{}, store)

	melati := insertSupplier(t, db, sellingA, "Melati")
	fold(t, svc, accept(1, sellingA, melati.ID, "2026-10-01", line{product: 100, ordered: 10, total: 10000, accepted: 10}))

	file, err := runFigureExport(t, svc, store, &supplierv1.SupplierFigureExportRequest{
		TeamId: sellingA, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_MONTHLY,
		Filters: filters(dateRange("2026-08-15", "2026-10-31"), oneSupplier(melati.ID)),
	})
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	if got := file.column(t, "Per Periode", "Periode"); !slices.Equal(got, []string{"Oktober 2026", "September 2026", "Agustus 2026"}) {
		t.Fatalf("months = %v", got)
	}

	if got := file.column(t, "Per Periode", "Direstok (unit)"); !slices.Equal(got, []string{"10", "0", "0"}) {
		t.Fatalf("restocked = %v", got)
	}
}

// Per Produk is every product the tab's search ranks — page after page — in its order, each named as the tab names it,
// the team column while no team is picked.
func TestSupplierFigureExport_PerProdukIsTheTabsRankingAcrossPages(t *testing.T) {
	db := san_testdb.DB(t)
	store := &fakeExports{
		products: map[uint64]supplier_v1.ExportProduct{
			100: {Name: "Kain Katun", Code: "KTN-01", TeamID: sellingA},
			900: {Name: "Kaos Polos", Code: "KAO-09", TeamID: sellingB},
		},
		teams: map[uint64]string{sellingA: "Toko Melati"},
	}
	svc := exportService(db, &fakeGoods{}, store)

	melati := insertSupplier(t, db, sellingA, "Melati")
	other := insertSupplier(t, db, sellingA, "Lain")

	fold(t, svc, accept(1, sellingA, melati.ID, "2026-10-01",
		line{product: 100, ordered: 10, total: 10000, accepted: 10},
		line{product: 101, ordered: 10, total: 90000, accepted: 10}))
	fold(t, svc, accept(2, sellingB, melati.ID, "2026-10-02", line{product: 900, ordered: 10, total: 50000, accepted: 10}))
	fold(t, svc, accept(3, sellingA, other.ID, "2026-10-02", line{product: 102, ordered: 10, total: 99000, accepted: 10}))

	file, err := runFigureExport(t, svc, store, &supplierv1.SupplierFigureExportRequest{
		TeamId: sellingA, GroupBy: byProduct, Filters: october(oneSupplier(melati.ID)),
	})
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	// The tab's own ranking, a page of one at a time.
	var listed []string
	for offset := int32(0); ; offset++ {
		got := search(t, svc, &supplierv1.MetricSearchRequest{
			GroupBy: byProduct, Filters: october(oneSupplier(melati.ID)), Sort: sortBy("restock_valuation", desc), Page: window(offset, 1),
		})
		for _, id := range got.GetKeys().GetIds().GetIds() {
			listed = append(listed, strconv.FormatUint(id, 10))
		}
		if !got.GetHasNext() {
			break
		}
	}

	rows := file.rows["Per Produk"]
	if !slices.Equal(rows[0], append([]string{"Produk", "SKU", "Tim"}, figureHeader...)) {
		t.Fatalf("header = %v", rows[0])
	}

	// 101 is unnamed — the tab's fallback, "Produk #101", and no team.
	want := [][]string{
		{"Produk #101", "", "", "10", "90000"},
		{"Kaos Polos", "KAO-09", "Tim #" + strconv.FormatUint(sellingB, 10), "10", "50000"},
		{"Kain Katun", "KTN-01", "Toko Melati", "10", "10000"},
	}

	if len(listed) != 3 || len(rows) != 4 {
		t.Fatalf("listed %v, file rows %v", listed, rows)
	}

	for i, w := range want {
		if !slices.Equal(rows[i+1][:5], w) {
			t.Fatalf("row %d = %v, want %v (ranked %v)", i+1, rows[i+1][:5], w, listed)
		}
	}

	if last := file.last(t); last.done != 3 || last.total != 3 || !strings.HasPrefix(last.name, "statistik-pemasok-per-produk-") {
		t.Fatalf("last message = %+v", last)
	}
}

// Whose restocks: with one team picked the file holds THAT team's products alone — another team's are not in it — and
// the team column goes, as on screen.
func TestSupplierFigureExport_ATeamPickedHoldsOnlyItsRestocks(t *testing.T) {
	db := san_testdb.DB(t)
	store := &fakeExports{products: map[uint64]supplier_v1.ExportProduct{
		100: {Name: "Kain Katun", TeamID: sellingA}, 900: {Name: "Kaos Polos", TeamID: sellingB},
	}}
	svc := exportService(db, &fakeGoods{}, store)

	melati := insertSupplier(t, db, sellingA, "Melati")
	fold(t, svc, accept(1, sellingA, melati.ID, "2026-10-01", line{product: 100, ordered: 10, total: 10000, accepted: 10}))
	fold(t, svc, accept(2, sellingB, melati.ID, "2026-10-02", line{product: 900, ordered: 10, total: 50000, accepted: 10}))

	file, err := runFigureExport(t, svc, store, &supplierv1.SupplierFigureExportRequest{
		TeamId: sellingA, GroupBy: byProduct, Filters: october(oneSupplier(melati.ID), restockTeam(sellingB)),
	})
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	rows := file.rows["Per Produk"]
	if slices.Contains(rows[0], "Tim") || len(rows) != 2 || rows[1][0] != "Kaos Polos" {
		t.Fatalf("rows = %v — want team B's product alone, no team column", rows)
	}

	// Per Periode the same way: team A's 10 units are not in team B's file.
	file, err = runFigureExport(t, svc, store, &supplierv1.SupplierFigureExportRequest{
		TeamId: sellingA, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_YEARLY, Filters: october(oneSupplier(melati.ID), restockTeam(sellingB)),
	})
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	if got := file.rows["Per Periode"][1]; got[0] != "2026" || got[1] != "10" || got[2] != "50000" {
		t.Fatalf("team B's year = %v, want its 10 units for Rp 50000 alone", got)
	}
}

// What the tab is not: no supplier (a file of every supplier is the Supplier Report's, SupplierReportExport), a group
// it never shows, and who may ask.
func TestSupplierFigureExport_Refusals(t *testing.T) {
	db := san_testdb.DB(t)
	store := &fakeExports{}
	svc := exportService(db, &fakeGoods{}, store)

	melati := insertSupplier(t, db, sellingA, "Melati")

	for name, req := range map[string]*supplierv1.SupplierFigureExportRequest{
		"no supplier": {TeamId: sellingA, GroupBy: byProduct, Filters: october()},
		"the ranking": {TeamId: sellingA, GroupBy: bySupplier, Filters: october(oneSupplier(melati.ID))},
	} {
		_, err := runFigureExport(t, svc, store, req)
		if connect.CodeOf(err) != connect.CodeInvalidArgument || store.content != nil {
			t.Fatalf("%s: err %v — want InvalidArgument and no file", name, err)
		}
	}

	assertExportPolicy(t, "warehouse.supplier.v1.SupplierFigureExportRequest",
		"warehouse.supplier.v1.SupplierAnalyticService.SupplierFigureExport")

	_, err := runFigureExport(t, supplier_v1.NewService(db, nil, nil, nil, nil), store, &supplierv1.SupplierFigureExportRequest{
		TeamId: sellingA, GroupBy: byProduct, Filters: october(oneSupplier(melati.ID)),
	})
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("no store: err = %v, want Unimplemented", err)
	}

	_ = context.Background
}
