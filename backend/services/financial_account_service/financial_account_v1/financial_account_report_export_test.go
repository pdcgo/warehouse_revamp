package financial_account_v1_test

import (
	"bytes"
	"context"
	"math"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/xuri/excelize/v2"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1/financial_accountv1connect"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// THE ACCOUNT REPORT AS A FILE (a-report-export-is-the-whole-view-as-a-file): Periode is every period at the grain,
// the quiet ones included, each row what the report's own MetricData reads for it; Rincian is one sheet per breakdown.

var periodHeader = []string{
	"Periode", "Penarikan", "Modal", "Restok", "Biaya", "Iklan", "Pembayaran tim", "Transfer", "Penyesuaian", "Saldo awal",
	"Perubahan bersih", "Saldo akhir",
}

// fakeReportExports keeps the stored file and names shops from a fixed map.
type fakeReportExports struct {
	content  []byte
	filename string
	teamID   uint64
	shops    map[uint64]string
	asked    [][]uint64
}

func (f *fakeReportExports) Store(_ context.Context, teamID uint64, filename string, content []byte) (string, error) {
	f.teamID, f.filename, f.content = teamID, filename, content

	return "https://files.example/" + filename, nil
}

func (f *fakeReportExports) ShopNames(_ context.Context, ids []uint64) (map[uint64]string, error) {
	f.asked = append(f.asked, ids)

	out := map[uint64]string{}
	for _, id := range ids {
		if name, ok := f.shops[id]; ok {
			out[id] = name
		}
	}

	return out, nil
}

// reportFile is what one export produced: the stream's last message and every sheet's rows, raw — a number as written.
type reportFile struct {
	sheets          []string
	rows            map[string][][]string
	done, total     int64
	url, name       string
	messages        int
	storedForTeamID uint64
}

// runReportExport runs FinancialAccountReportExport end to end over a real HTTP server (a streaming handler cannot be
// called directly); a stream error is returned.
func runReportExport(
	t *testing.T, svc *financial_account_v1.Service, store *fakeReportExports, req *financial_accountv1.FinancialAccountReportExportRequest,
) (reportFile, error) {
	t.Helper()

	mux := http.NewServeMux()
	mux.Handle(financial_accountv1connect.NewFinancialAccountAnalyticServiceHandler(svc))

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	client := financial_accountv1connect.NewFinancialAccountAnalyticServiceClient(http.DefaultClient, server.URL)

	stream, err := client.FinancialAccountReportExport(context.Background(), connect.NewRequest(req))
	if err != nil {
		return reportFile{}, err
	}
	defer func() { _ = stream.Close() }()

	out := reportFile{rows: map[string][][]string{}}

	for stream.Receive() {
		m := stream.Msg()
		out.messages++
		out.done, out.total, out.url, out.name = m.GetDone(), m.GetTotal(), m.GetDownloadUrl(), m.GetFilename()
	}

	if stream.Err() != nil {
		return reportFile{}, stream.Err()
	}

	file, err := excelize.OpenReader(bytes.NewReader(store.content))
	if err != nil {
		t.Fatalf("open the exported file: %v", err)
	}
	defer func() { _ = file.Close() }()

	out.sheets = file.GetSheetList()
	out.storedForTeamID = store.teamID

	for _, sheet := range out.sheets {
		rows, err := file.GetRows(sheet, excelize.Options{RawCellValue: true})
		if err != nil {
			t.Fatalf("read %s: %v", sheet, err)
		}

		out.rows[sheet] = rows
	}

	return out, nil
}

func periodExport(team uint64, group analytic_basev1.GroupType, dir analytic_basev1.SortType, filters ...*analytic_basev1.FilterItem) *financial_accountv1.FinancialAccountReportExportRequest {
	return &financial_accountv1.FinancialAccountReportExportRequest{
		TeamId:   team,
		View:     financial_accountv1.FinancialAccountReportView_FINANCIAL_ACCOUNT_REPORT_VIEW_PERIOD,
		Filters:  filters,
		GroupBy:  group,
		SortType: dir,
	}
}

func breakdownExport(team uint64, filters ...*analytic_basev1.FilterItem) *financial_accountv1.FinancialAccountReportExportRequest {
	return &financial_accountv1.FinancialAccountReportExportRequest{
		TeamId:  team,
		View:    financial_accountv1.FinancialAccountReportView_FINANCIAL_ACCOUNT_REPORT_VIEW_BREAKDOWN,
		Filters: filters,
	}
}

// money is a figure as the file must hold it — exact, never rounded.
func money(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

// periodRow is a Periode row as the report reads one period: its label, the nine types in the screen's order, the net
// and the closing balance.
func periodRow(label string, c *financial_accountv1.AccountChangeMetric) []string {
	return []string{
		label,
		money(c.GetWithdrawal()), money(c.GetCapital()), money(c.GetRestock()), money(c.GetExpense()), money(c.GetAdsExpense()),
		money(c.GetTeamPayment()), money(c.GetTransfer()), money(c.GetAdjustment()), money(c.GetAccountOpening()),
		money(c.GetChange()), money(c.GetClosingBalance()),
	}
}

// Periode at a day: every day of the window — newest first as the screen opens it, the quiet ones included — and each
// row exactly what the report's MetricData answers when it pages through the same window 20 periods at a time.
func TestFinancialAccountReportExport_PeriodeIsEveryPeriodAsTheReportReadsIt(t *testing.T) {
	b := book(t)
	store := &fakeReportExports{}
	svc := financial_account_v1.NewService(b.db, testShops, store)

	file, err := runReportExport(t, svc, store, periodExport(teamA, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		analytic_basev1.SortType_SORT_TYPE_UNSPECIFIED, window(45, 0)))
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	if !slices.Equal(file.sheets, []string{"Periode"}) {
		t.Fatalf("sheets = %v, want Periode alone", file.sheets)
	}

	rows := file.rows["Periode"]
	if !slices.Equal(rows[0], periodHeader) {
		t.Fatalf("header = %v, want %v", rows[0], periodHeader)
	}

	// 46 days, newest first — the spine the screen lists itself.
	var spine []string
	for ago := 0; ago <= 45; ago++ {
		spine = append(spine, day(ago))
	}

	if len(rows)-1 != len(spine) {
		t.Fatalf("%d periods, want %d — every day of the window, the quiet ones too", len(rows)-1, len(spine))
	}

	// The report's own reads: the spine paged 20 at a time, each page filled by MetricData.
	for start := 0; start < len(spine); start += 20 {
		page := spine[start:min(start+20, len(spine))]
		items := fill(t, b.svc, teamA, analytic_basev1.GroupType_GROUP_TYPE_DAILY, dayKeys(page...), window(45, 0)).
			GetMetricDatas()[0].GetChangesByDay().GetItems()

		for i, key := range page {
			want := periodRow(key, items[key])
			if got := rows[start+i+1]; !slices.Equal(got, want) {
				t.Fatalf("row %s = %v, want the report's %v", key, got, want)
			}
		}
	}

	// A quiet day is a row: nothing moved, the balance carried — day 15 sits between Tabungan's opening and the rest.
	quiet := rows[slices.Index(spine, day(15))+1]
	if quiet[10] != "0" || quiet[11] != "30000" {
		t.Fatalf("a quiet day = %v — want no change and Tabungan's 30000 carried", quiet)
	}

	// The newest day closes on the team's balance.
	if rows[1][0] != day(0) || rows[1][11] != "1580000" {
		t.Fatalf("today = %v, want the team's 1580000", rows[1])
	}

	if file.done != 46 || file.total != 46 || !strings.HasPrefix(file.name, "laporan-akun-periode-") || file.url == "" {
		t.Fatalf("last message = done %d total %d name %q url %q", file.done, file.total, file.name, file.url)
	}

	if file.storedForTeamID != teamA {
		t.Fatalf("stored for team %d, want the caller's team", file.storedForTeamID)
	}

	// ASC, as the Periode heading flips it: the same rows, oldest first.
	asc, err := runReportExport(t, svc, store, periodExport(teamA, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		analytic_basev1.SortType_SORT_TYPE_ASC, window(45, 0)))
	if err != nil {
		t.Fatalf("export asc: %v", err)
	}

	flipped := slices.Clone(asc.rows["Periode"][1:])
	slices.Reverse(flipped)

	for i := range flipped {
		if !slices.Equal(flipped[i], rows[i+1]) {
			t.Fatalf("ASC row %d = %v, want %v reversed", i, flipped[i], rows[i+1])
		}
	}
}

// Periode at a month and a year reads each period as the screen's table does — `2026-10`, `2026` — every one of the
// window, the cut edges at the range.
func TestFinancialAccountReportExport_AMonthAndAYearReadAsTheTable(t *testing.T) {
	b := book(t)
	store := &fakeReportExports{}
	svc := financial_account_v1.NewService(b.db, testShops, store)

	for group, layout := range map[analytic_basev1.GroupType]string{
		analytic_basev1.GroupType_GROUP_TYPE_MONTHLY: "2006-01",
		analytic_basev1.GroupType_GROUP_TYPE_YEARLY:  "2006",
	} {
		file, err := runReportExport(t, svc, store, periodExport(teamA, group, analytic_basev1.SortType_SORT_TYPE_DESC, window(120, 0)))
		if err != nil {
			t.Fatalf("%s: %v", group, err)
		}

		rows := file.rows["Periode"]

		// The screen's spine, newest first.
		var want []string

		start, _ := time.Parse("2006-01-02", day(120))
		end, _ := time.Parse("2006-01-02", day(0))

		for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
			if label := d.Format(layout); !slices.Contains(want, label) {
				want = append(want, label)
			}
		}

		slices.Reverse(want)

		var got []string
		for _, row := range rows[1:] {
			got = append(got, row[0])
		}

		if !slices.Equal(got, want) {
			t.Fatalf("%s periods = %v, want %v", group, got, want)
		}

		// The newest closes on the team's balance; the oldest is quiet — before any account opened — at 0.
		if rows[1][11] != "1580000" || rows[len(rows)-1][11] != "0" && len(rows) > 2 {
			t.Fatalf("%s: newest %v, oldest %v", group, rows[1], rows[len(rows)-1])
		}
	}
}

// Rincian is ONE SHEET PER BREAKDOWN, every row of each, in the screen's order — and each row the figures the report's
// own ranking reads for it; every sheet's Total is the headline.
func TestFinancialAccountReportExport_RincianIsOneSheetPerBreakdown(t *testing.T) {
	b := book(t)
	store := &fakeReportExports{}
	svc := financial_account_v1.NewService(b.db, testShops, store)

	file, err := runReportExport(t, svc, store, breakdownExport(teamA, window(30, 0)))
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	if !slices.Equal(file.sheets, []string{"Per Akun", "Per Penyedia", "Per Jenis"}) {
		t.Fatalf("sheets = %v", file.sheets)
	}

	if !strings.HasPrefix(file.name, "laporan-akun-rincian-") {
		t.Fatalf("filename = %q", file.name)
	}

	// Per Akun: the largest movement first — BCA Ops +1.300.000, Kas +250.000, Tabungan +30.000 — and a Total.
	want := [][]string{
		{"Akun", "Penyedia", "Status", "Saldo awal", "Perubahan bersih", "Saldo akhir"},
		{"BCA Ops", "BCA", "", "0", "1300000", "1300000"},
		{"Kas", "Kas", "", "0", "250000", "250000"},
		{"Tabungan", "Kas", "", "0", "30000", "30000"},
		{"Total", "", "", "0", "1580000", "1580000"},
	}
	assertRows(t, file, "Per Akun", want)

	// Each account row is what the report's ranking fills it with.
	ranked := search(t, b.svc, teamA, analytic_basev1.GroupType_GROUP_TYPE_ACCOUNT, metricChanges, "change",
		analytic_basev1.SortType_SORT_TYPE_DESC, window(30, 0)).GetKeys().GetIds().GetIds()
	filled := fill(t, b.svc, teamA, analytic_basev1.GroupType_GROUP_TYPE_ACCOUNT, idKeys(ranked...), window(30, 0)).
		GetMetricDatas()[0].GetChangesById().GetItems()

	if len(ranked) != 3 {
		t.Fatalf("the report ranks %d accounts, want 3", len(ranked))
	}

	for row, id := range []uint64{b.ops, b.kas, b.quiet} {
		c := filled[id]
		got := file.rows["Per Akun"][row+1][3:]

		if !slices.Equal(got, []string{money(c.GetOpeningBalance()), money(c.GetChange()), money(c.GetClosingBalance())}) {
			t.Fatalf("account %d = %v, want the report's %v", id, got, c)
		}
	}

	head := headline(t, b.svc, teamA, window(30, 0))
	if total := file.rows["Per Akun"][4]; total[5] != money(head.GetClosingBalance()) || total[4] != money(head.GetChange()) {
		t.Fatalf("Total = %v, want the headline %v", total, head)
	}

	// Per Penyedia: BCA, then Kas (Kas and Tabungan together).
	assertRows(t, file, "Per Penyedia", [][]string{
		{"Penyedia", "Saldo awal", "Perubahan bersih", "Saldo akhir"},
		{"BCA", "0", "1300000", "1300000"},
		{"Kas", "0", "280000", "280000"},
		{"Total", "0", "1580000", "1580000"},
	})

	// Per Jenis: the bridge — Saldo awal, money in by size, money out, Saldo akhir. The transfer nets to 0 over the
	// team, so it is no line, as on screen.
	assertRows(t, file, "Per Jenis", [][]string{
		{"Jenis", "Arah", "Jumlah"},
		{"Saldo awal", "", "0"},
		{"Saldo awal", "Masuk", "1130000"},
		{"Penarikan", "Masuk", "500000"},
		{"Modal", "Keluar", "-50000"},
		{"Saldo akhir", "", "1580000"},
	})

	if file.done != file.total || file.total != 3+2+5 {
		t.Fatalf("progress done %d of %d, want every row of the three sheets (10)", file.done, file.total)
	}
}

// SCOPE: a team's file holds its own accounts and nothing of another team's — a selling team's, a warehouse's.
func TestFinancialAccountReportExport_AnotherTeamGetsNothing(t *testing.T) {
	b := book(t)
	store := &fakeReportExports{}
	svc := financial_account_v1.NewService(b.db, testShops, store)

	file, err := runReportExport(t, svc, store, breakdownExport(teamB, window(30, 0)))
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	assertRows(t, file, "Per Akun", [][]string{
		{"Akun", "Penyedia", "Status", "Saldo awal", "Perubahan bersih", "Saldo akhir"},
		{"Kas B", "Kas", "", "0", "7777", "7777"},
		{"Total", "", "", "0", "7777", "7777"},
	})

	periods, err := runReportExport(t, svc, store, periodExport(teamB, analytic_basev1.GroupType_GROUP_TYPE_YEARLY,
		analytic_basev1.SortType_SORT_TYPE_DESC, window(30, 0)))
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	for _, row := range periods.rows["Periode"][1:] {
		if row[11] != "7777" && row[11] != "0" {
			t.Fatalf("team B's period %v carries another team's money", row)
		}
	}

	// A warehouse reads its own (every-team-reads-its-own-finance) — and team A's accounts are in neither file.
	warehouse, err := runReportExport(t, svc, store, breakdownExport(teamW, window(30, 0)))
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	for _, f := range []reportFile{file, warehouse} {
		for _, row := range f.rows["Per Akun"] {
			if slices.Contains([]string{"BCA Ops", "Kas", "Tabungan"}, row[0]) {
				t.Fatalf("team A's %s leaked into another team's file", row[0])
			}
		}
	}

	if got := warehouse.rows["Per Akun"][1]; got[0] != "Kas Gudang" || got[5] != "260000" {
		t.Fatalf("the warehouse's own = %v", got)
	}
}

// An account picked narrows every sheet to it — the Periode balances are its own, Rincian its one row and provider.
func TestFinancialAccountReportExport_AnAccountPickedNarrowsEverySheet(t *testing.T) {
	b := book(t)
	store := &fakeReportExports{}
	svc := financial_account_v1.NewService(b.db, testShops, store)

	file, err := runReportExport(t, svc, store, breakdownExport(teamA, window(30, 0), accountsFilter(b.kas)))
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	assertRows(t, file, "Per Akun", [][]string{
		{"Akun", "Penyedia", "Status", "Saldo awal", "Perubahan bersih", "Saldo akhir"},
		{"Kas", "Kas", "", "0", "250000", "250000"},
		{"Total", "", "", "0", "250000", "250000"},
	})

	assertRows(t, file, "Per Penyedia", [][]string{
		{"Penyedia", "Saldo awal", "Perubahan bersih", "Saldo akhir"},
		{"Kas", "0", "250000", "250000"},
		{"Total", "0", "250000", "250000"},
	})

	// Kas's own types: opened 100.000, the transfer in 200.000, the capital out 50.000.
	assertRows(t, file, "Per Jenis", [][]string{
		{"Jenis", "Arah", "Jumlah"},
		{"Saldo awal", "", "0"},
		{"Transfer", "Masuk", "200000"},
		{"Saldo awal", "Masuk", "100000"},
		{"Modal", "Keluar", "-50000"},
		{"Saldo akhir", "", "250000"},
	})

	periods, err := runReportExport(t, svc, store, periodExport(teamA, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		analytic_basev1.SortType_SORT_TYPE_DESC, window(30, 0), accountsFilter(b.kas)))
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	if got := periods.rows["Periode"][1]; got[11] != "250000" {
		t.Fatalf("today under Kas = %v, want Kas's 250000", got)
	}
}

// MONEY IS EXACT (the-backend-never-rounds-money): a figure with a fraction is written to its fraction, in Periode and
// Rincian alike — the screen rounds, the file does not.
func TestFinancialAccountReportExport_MoneyIsExact(t *testing.T) {
	db := san_testdb.DB(t)
	store := &fakeReportExports{}
	svc := financial_account_v1.NewService(db, testShops, store)

	kas := mustCreate(t, svc, cash(teamA, "Kas", 1_000.25))
	capital(t, svc, teamA, kas.GetId(), financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_IN, 12_345.505, day(2))

	periods, err := runReportExport(t, svc, store, periodExport(teamA, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		analytic_basev1.SortType_SORT_TYPE_DESC, window(10, 0)))
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	rows := periods.rows["Periode"]
	if got := rows[3]; got[0] != day(2) || got[2] != "12345.505" || got[10] != "12345.505" || got[11] != "13345.755" {
		t.Fatalf("day 2 = %v — want the capital 12345.505 and the balance 13345.755, exact", got)
	}

	if got := rows[11]; got[0] != day(10) || got[9] != "1000.25" {
		t.Fatalf("day 10 = %v — want the opening 1000.25 exact", got)
	}

	breakdown, err := runReportExport(t, svc, store, breakdownExport(teamA, window(10, 0)))
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	if got := breakdown.rows["Per Akun"][1]; got[4] != "13345.755" || got[5] != "13345.755" {
		t.Fatalf("Kas = %v, want 13345.755 exact", got)
	}

	if got := breakdown.rows["Per Jenis"]; got[2][0] != "Modal" || got[2][2] != "12345.505" || got[3][2] != "1000.25" {
		t.Fatalf("Per Jenis = %v", got)
	}

	if math.Abs(13345.755-(1000.25+12345.505)) > 1e-9 {
		t.Fatal("the fixture's sum moved")
	}
}

// An account is NAMED as the report names it (the-unknown-account-reads-lainnya): an unknown account by the shop whose
// withdrawals it holds, provider Lainnya; an archived one carries its mark.
func TestFinancialAccountReportExport_AccountsReadAsTheReportNamesThem(t *testing.T) {
	db := san_testdb.DB(t)
	store := &fakeReportExports{shops: map[uint64]string{502: "Melati TikTok"}}
	svc := financial_account_v1.NewService(db, testShops, store)

	// Shop 502 names no account: its withdrawal opens "Unknown — shop #502".
	withdraw(t, svc, "evt-export-1", teamA, 502, -75_000, day(4))

	old := mustCreate(t, svc, cash(teamA, "Kas Lama", 100))
	kas := mustCreate(t, svc, cash(teamA, "Kas", 0))
	mustTransfer(t, svc, teamA, old.GetId(), kas.GetId(), 100, day(3))

	_, err := svc.FinancialAccountArchive(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountArchiveRequest{
		TeamId: teamA, AccountId: old.GetId(),
	}))
	if err != nil {
		t.Fatalf("archive: %v", err)
	}

	file, err := runReportExport(t, svc, store, breakdownExport(teamA, window(30, 0)))
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	byName := map[string][]string{}
	for _, row := range file.rows["Per Akun"][1:] {
		byName[row[0]] = row
	}

	if got := byName["Melati TikTok"]; got == nil || got[1] != "Lainnya" || got[5] != "75000" {
		t.Fatalf("the unknown account = %v (rows %v) — want it named by its shop, provider Lainnya", got, file.rows["Per Akun"])
	}

	if got := byName["Kas Lama"]; got == nil || got[2] != "Diarsipkan" || got[5] != "0" {
		t.Fatalf("the archived account = %v — want its mark and its 0", got)
	}

	if len(store.asked) != 1 || !slices.Contains(store.asked[0], 502) {
		t.Fatalf("shops asked %v, want 502 named once", store.asked)
	}
}

// What the report is not: a view it does not have, a Periode with no grain or a week, no window; who may ask; no store.
func TestFinancialAccountReportExport_Refusals(t *testing.T) {
	db := san_testdb.DB(t)
	store := &fakeReportExports{}
	svc := financial_account_v1.NewService(db, testShops, store)

	for name, req := range map[string]*financial_accountv1.FinancialAccountReportExportRequest{
		"no view":           {TeamId: teamA, Filters: []*analytic_basev1.FilterItem{window(30, 0)}},
		"periode, no grain": periodExport(teamA, analytic_basev1.GroupType_GROUP_TYPE_UNSPECIFIED, analytic_basev1.SortType_SORT_TYPE_DESC, window(30, 0)),
		"periode by week":   periodExport(teamA, analytic_basev1.GroupType_GROUP_TYPE_WEEKLY, analytic_basev1.SortType_SORT_TYPE_DESC, window(30, 0)),
		"no window":         breakdownExport(teamA, accountsFilter(1)),
		"over a year":       breakdownExport(teamA, window(400, 0)),
	} {
		_, err := runReportExport(t, svc, store, req)
		if connect.CodeOf(err) != connect.CodeInvalidArgument || store.content != nil {
			t.Fatalf("%s: err %v — want InvalidArgument and no file", name, err)
		}
	}

	// The report's readers — every team's own, a warehouse's included — and NOT a read: it stores a file, so the admin
	// team's monitor and an agent are refused (the-admin-team-monitors-read-only).
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.financial_account.v1.FinancialAccountReportExportRequest")
	if err != nil {
		t.Fatal(err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT, role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER, role_basev1.Role_ROLE_SELLING_ADMIN, role_basev1.Role_ROLE_SELLING_CS,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER, role_basev1.Role_ROLE_WAREHOUSE_ADMIN, role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	}
	if policy == nil || !slices.Equal(policy.GetRoles(), want) {
		t.Fatalf("policy = %v, want MetricData's readers %v", policy, want)
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName(
		"warehouse.financial_account.v1.FinancialAccountAnalyticService.FinancialAccountReportExport")
	if err != nil {
		t.Fatal(err)
	}

	options, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if options.GetIdempotencyLevel() == descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("the export stores a file — it must not be marked a read")
	}

	_, err = runReportExport(t, financial_account_v1.NewService(db, testShops, nil), store, breakdownExport(teamA, window(30, 0)))
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("no store: err = %v, want Unimplemented", err)
	}
}

func assertRows(t *testing.T, file reportFile, sheet string, want [][]string) {
	t.Helper()

	got := file.rows[sheet]
	if len(got) != len(want) {
		t.Fatalf("%s = %v, want %v", sheet, got, want)
	}

	for i := range want {
		// A sheet's row ends at its last filled cell.
		w := slices.Clone(want[i])
		for len(w) > 0 && w[len(w)-1] == "" {
			w = w[:len(w)-1]
		}

		if !slices.Equal(got[i], w) {
			t.Fatalf("%s row %d = %v, want %v", sheet, i, got[i], w)
		}
	}
}
