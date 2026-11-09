package supplier_v1_test

import (
	"context"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1/supplierv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// THE SUPPLIER REPORT AS A FILE (a-report-export-is-the-whole-view-as-a-file): the whole ranking as narrowed, every page,
// each supplier with its figures.

var reportHeader = append([]string{"Peringkat", "Pemasok", "Status", "Dikelola oleh"}, figureHeader...)

// runReportExport runs SupplierReportExport end to end; a stream error is returned, not fatal.
func runReportExport(t *testing.T, svc *supplier_v1.Service, store *fakeExports, req *supplierv1.SupplierReportExportRequest) (exportFile, error) {
	t.Helper()

	client := supplierv1connect.NewSupplierAnalyticServiceClient(http.DefaultClient, serve(t, svc))

	stream, err := client.SupplierReportExport(context.Background(), connect.NewRequest(req))
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

func keywordFilter(q string) *analytic_basev1.FilterItem {
	return &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_SupplierKeywordFilter{
		SupplierKeywordFilter: &analytic_basev1.SupplierKeywordFilter{Q: q},
	}}
}

// reportRanking is the report's own reads for a filter and order: MetricSearch by SUPPLIER a page of `size` at a time,
// as the screen pages, each page filled by MetricData — the rows the screen shows, in its order.
func reportRanking(t *testing.T, svc *supplier_v1.Service, filters []*analytic_basev1.FilterItem, sort *analytic_basev1.MetricSort, size int32) ([]uint64, map[uint64]*supplierv1.SupplierMetric) {
	t.Helper()

	var ids []uint64

	figures := map[uint64]*supplierv1.SupplierMetric{}

	for offset := int32(0); ; offset += size {
		page := search(t, svc, &supplierv1.MetricSearchRequest{GroupBy: bySupplier, Filters: filters, Sort: sort, Page: window(offset, size)})
		keys := page.GetKeys().GetIds().GetIds()
		ids = append(ids, keys...)

		if len(keys) > 0 {
			for id, m := range fill(t, svc, &supplierv1.MetricDataRequest{GroupBy: bySupplier, Filters: filters, Keys: idKeys(keys...)}).GetSupplierById().GetItems() {
				figures[id] = m
			}
		}

		if !page.GetHasNext() {
			return ids, figures
		}
	}
}

// figureStrings is a figures row as the file holds it — exact, a rate empty where nothing arrived.
func figureStrings(m *supplierv1.SupplierMetric) []string {
	return []string{
		strconv.FormatInt(m.GetRestockCount(), 10), strconv.FormatFloat(m.GetRestockValuation(), 'f', -1, 64),
		strconv.FormatInt(m.GetSalesCount(), 10), strconv.FormatFloat(m.GetSalesValue(), 'f', -1, 64),
		strconv.FormatInt(m.GetShippingLostCount(), 10), strconv.FormatFloat(m.GetShippingLostValuation(), 'f', -1, 64),
		rate(m.GetShippingLostCount(), m),
		strconv.FormatInt(m.GetShippingBrokenCount(), 10), strconv.FormatFloat(m.GetShippingBrokenValuation(), 'f', -1, 64),
		rate(m.GetShippingBrokenCount(), m),
	}
}

func trimEnd(row []string) []string {
	for len(row) > 0 && row[len(row)-1] == "" {
		row = row[:len(row)-1]
	}

	return row
}

// THE WHOLE RANKING: more suppliers than one step of the export (200) and many pages of the screen (20) — the file's
// rows are exactly the report's, page after page, in its order, each with the figures its MetricData reads, Penjualan
// included; the rank counts across every page.
func TestSupplierReportExport_TheFileIsTheWholeRankingAcrossPages(t *testing.T) {
	db := san_testdb.DB(t)
	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{}}
	store := &fakeExports{teams: map[uint64]string{sellingA: "Toko Melati"}}
	svc := exportService(db, goods, store)

	melati, sinar, kecil, lama := seedRanking(t, db, svc)

	// 210 more, each restocked a different value — 214 suppliers ranked.
	for i := 1; i <= 210; i++ {
		s := insertSupplier(t, db, sellingA, "Pemasok Uji "+strconv.Itoa(i))
		fold(t, svc, accept(uint64(100+i), sellingA, s.ID, "2026-10-10", line{product: 100, ordered: 1, total: int64(i * 10), accepted: 1}))
	}

	// Penjualan: Melati's goods sold 8 units on 8 October for Rp 800.000 — the report's sales column.
	goods.takes[7001] = []supplier_v1.SaleTakePart{{ProductID: 100, SupplierID: melati.ID, TeamID: sellingA, Units: 8}}
	salesFold(t, svc, salePlaced(1, 7001, wib("2026-10-08", "10:00"), 800_000, saleLine(100, 8, 800_000)))

	sort := sortBy("restock_valuation", desc)

	file, err := runReportExport(t, svc, store, &supplierv1.SupplierReportExportRequest{TeamId: sellingA, Filters: october(), Sort: sort})
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	if !slices.Equal(file.sheets, []string{"Peringkat"}) {
		t.Fatalf("sheets = %v", file.sheets)
	}

	rows := file.rows["Peringkat"]
	if !slices.Equal(rows[0], reportHeader) {
		t.Fatalf("header = %v, want %v", rows[0], reportHeader)
	}

	ids, figures := reportRanking(t, svc, october(), sort, 20)
	if len(ids) != 214 || len(rows)-1 != len(ids) {
		t.Fatalf("the report ranks %d, the file holds %d — want 214 each", len(ids), len(rows)-1)
	}

	for i, id := range ids {
		got := rows[i+1]
		if got[0] != strconv.Itoa(i+1) {
			t.Fatalf("row %d ranks %s, want %d — the rank counts across every page", i+1, got[0], i+1)
		}

		if want := trimEnd(figureStrings(figures[id])); !slices.Equal(trimEnd(slices.Clone(got[4:])), want) {
			t.Fatalf("row %d (supplier %d) figures = %v, want the report's %v", i+1, id, got[4:], want)
		}
	}

	// The top rows by name: Melati (Rp 960.000, Penjualan 8 · Rp 800.000), then the deleted Lama, marked, its figures kept.
	if got := rows[1]; got[1] != "Melati" || got[2] != "" || got[3] != "Toko Melati" || got[6] != "8" || got[7] != "800000" {
		t.Fatalf("first = %v — want Melati, kept by Toko Melati, Penjualan 8 for Rp 800000", got)
	}

	if got := rows[2]; got[1] != "Lama Tutup" || got[2] != "Dihapus" || got[5] != "500000" {
		t.Fatalf("second = %v — want the deleted Lama Tutup, marked, Rp 500000", got)
	}

	// A team the names cannot resolve reads as the screen reads it.
	at := slices.Index(ids, sinar.ID)
	if got := rows[at+1]; got[3] != "Tim #"+strconv.FormatUint(sellingB, 10) {
		t.Fatalf("Sinar's team = %q, want the fallback", got[3])
	}

	_ = kecil
	_ = lama

	last := file.last(t)
	if last.done != 214 || last.total != 214 || !strings.HasPrefix(last.name, "laporan-pemasok-") || last.url == "" {
		t.Fatalf("last message = %+v", last)
	}

	if store.teamID != sellingA {
		t.Fatalf("stored for team %d, want the caller's", store.teamID)
	}
}

// AS NARROWED: the search, the team and the order the report was read with are the file's — by broken rate the
// minimum sample ranks as on screen; a search keeps only what it finds; a team only its restocks.
func TestSupplierReportExport_TheFileIsNarrowedAsTheReport(t *testing.T) {
	db := san_testdb.DB(t)
	store := &fakeExports{}
	svc := exportService(db, &fakeGoods{}, store)

	melati, sinar, kecil, lama := seedRanking(t, db, svc)

	names := func(file exportFile) []string { return file.column(t, "Peringkat", "Pemasok") }

	for name, c := range map[string]struct {
		filters []*analytic_basev1.FilterItem
		sort    *analytic_basev1.MetricSort
		want    []string
	}{
		"by broken rate": {october(), sortBy("broken_rate", desc), []string{"Melati", "Toko Sinar", "Lama Tutup", "Toko Kecil"}},
		"the search":     {october(keywordFilter("toko")), sortBy("restock_valuation", desc), []string{"Toko Sinar", "Toko Kecil"}},
		"one team":       {october(restockTeam(sellingB)), sortBy("restock_valuation", desc), []string{"Toko Sinar"}},
	} {
		file, err := runReportExport(t, svc, store, &supplierv1.SupplierReportExportRequest{TeamId: sellingA, Filters: c.filters, Sort: c.sort})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		if got := names(file); !slices.Equal(got, c.want) {
			t.Fatalf("%s = %v, want %v", name, got, c.want)
		}

		ids, _ := reportRanking(t, svc, c.filters, c.sort, 2)
		if len(ids) != len(c.want) {
			t.Fatalf("%s: the report ranks %d, the file %d", name, len(ids), len(c.want))
		}
	}

	// Team B's restocks alone: Sinar's 117 units, nothing of team A's.
	file, err := runReportExport(t, svc, store, &supplierv1.SupplierReportExportRequest{
		TeamId: sellingA, Filters: october(restockTeam(sellingB)), Sort: sortBy("restock_valuation", desc),
	})
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	if got := file.rows["Peringkat"][1]; got[4] != "117" || got[5] != "117000" {
		t.Fatalf("team B's Sinar = %v, want its 117 units for Rp 117000", got)
	}

	// A broken share is the exact ratio: Kecil 1 of 2.
	file, err = runReportExport(t, svc, store, &supplierv1.SupplierReportExportRequest{
		TeamId: sellingA, Filters: october(keywordFilter("kecil")), Sort: sortBy("restock_valuation", desc),
	})
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	if got := file.rows["Peringkat"][1]; got[11] != "1" || got[13] != "0.5" {
		t.Fatalf("Kecil = %v, want 1 broken at exactly 0.5", got)
	}

	_, _, _, _ = melati, sinar, kecil, lama
}

// What the report is not: one supplier (that is its Statistik tab), a sort of another metric; who may ask; no store.
func TestSupplierReportExport_Refusals(t *testing.T) {
	db := san_testdb.DB(t)
	store := &fakeExports{}
	svc := exportService(db, &fakeGoods{}, store)

	melati := insertSupplier(t, db, sellingA, "Melati")

	for name, req := range map[string]*supplierv1.SupplierReportExportRequest{
		"one supplier": {TeamId: sellingA, Filters: october(oneSupplier(melati.ID)), Sort: sortBy("restock_valuation", desc)},
		"no window":    {TeamId: sellingA, Filters: filters(restockTeam(sellingA)), Sort: sortBy("restock_valuation", desc)},
		"another metric": {TeamId: sellingA, Filters: october(), Sort: &analytic_basev1.MetricSort{
			MetricId: "metrics/financial_accounts", Field: "change", SortType: desc,
		}},
		"no such field": {TeamId: sellingA, Filters: october(), Sort: sortBy("contact", desc)},
	} {
		_, err := runReportExport(t, svc, store, req)
		if connect.CodeOf(err) != connect.CodeInvalidArgument || store.content != nil {
			t.Fatalf("%s: err %v — want InvalidArgument and no file", name, err)
		}
	}

	assertExportPolicy(t, "warehouse.supplier.v1.SupplierReportExportRequest",
		"warehouse.supplier.v1.SupplierAnalyticService.SupplierReportExport")

	_, err := runReportExport(t, supplier_v1.NewService(db, nil, nil, nil, nil), store, &supplierv1.SupplierReportExportRequest{
		TeamId: sellingA, Filters: october(), Sort: sortBy("restock_valuation", desc),
	})
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("no store: err = %v, want Unimplemented", err)
	}
}
