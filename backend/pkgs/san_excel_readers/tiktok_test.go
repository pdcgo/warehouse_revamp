package san_excel_readers_test

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_excel_readers"
	"github.com/xuri/excelize/v2"
)

const tiktokSamples = "../../../examples/settlement_samples/tiktok"

func openTiktokSample(t *testing.T, name string) san_excel_readers.TiktokSettlementDocument {
	t.Helper()

	file, err := os.Open(filepath.Join(tiktokSamples, name))
	if os.IsNotExist(err) {
		t.Skipf("sample %q is not in this checkout", name)
	}
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	doc, err := san_excel_readers.NewTiktokSettlementDocument(file)
	if err != nil {
		t.Fatalf("parsing %s: %v", name, err)
	}

	return doc
}

func tiktokSampleNames(t *testing.T) []string {
	t.Helper()

	entries, err := os.ReadDir(tiktokSamples)
	if os.IsNotExist(err) {
		t.Skip("no tiktok samples in this checkout")
	}
	if err != nil {
		t.Fatal(err)
	}

	names := []string{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".xlsx" || entry.Name()[0] == '.' {
			continue
		}
		names = append(names, entry.Name())
	}

	return names
}

// Counts measured from the samples. Note how far the row COUNT is from the sheet's used range:
// niko_lape has 219 row elements and 43 orders, the rest being blank padding.
func TestTiktokSettlementDocument(t *testing.T) {
	cases := []struct {
		file        string
		orders      int
		withdrawals int
		from        string
		to          string
	}{
		{"87_IDLCAHTLWX6_10_05_2025_12_08.xlsx", 73, 40, "2025-11-07", "2025-12-08"},
		{"cannot_open.xlsx", 4, 4, "2026-09-18", "2026-09-24"}, // the September 2026 layout
		{"gmv_mlongo.xlsx", 101, 5, "2026-02-14", "2026-02-16"},
		{"gmv_payment.xlsx", 489, 13, "2025-12-05", "2025-12-15"},
		{"husen_campaign.xlsx", 36, 7, "2025-12-18", "2025-12-22"},
		{"isna_negative.xlsx", 91, 4, "2026-03-13", "2026-03-14"},
		{"niko_lape.xlsx", 43, 9, "2025-12-18", "2025-12-24"},
		{"niko_lape_full.xlsx", 105, 19, "2025-12-10", "2025-12-24"},
		{"niko_sisa_onlast.xlsx", 47, 10, "2025-12-20", "2025-12-27"},
		{"overlapping_earning.xlsx", 417, 43, "2025-10-31", "2025-11-29"},
		{"pay_deduction.xlsx", 283, 14, "2026-01-01", "2026-01-05"},
		{"pivan_fund_invalid.xlsx", 156, 37, "2025-12-01", "2025-12-27"},
		{"salah_tarik.xlsx", 59, 5, "2026-01-20", "2026-01-22"},
		{"shipping_issurance.xlsx", 830, 41, "2026-01-01", "2026-01-26"},
	}

	for _, tc := range cases {
		t.Run(tc.file, func(t *testing.T) {
			doc := openTiktokSample(t, tc.file)

			items, err := doc.GetItems()
			if err != nil {
				t.Fatal(err)
			}
			if len(items) != tc.orders {
				t.Errorf("orders = %d, want %d", len(items), tc.orders)
			}

			withdrawals, err := doc.GetWithdrawals()
			if err != nil {
				t.Fatal(err)
			}
			if len(withdrawals) != tc.withdrawals {
				t.Errorf("withdrawals = %d, want %d", len(withdrawals), tc.withdrawals)
			}

			from, to, err := doc.GetPeriod()
			if err != nil {
				t.Fatal(err)
			}
			if got := from.Format("2006-01-02"); got != tc.from {
				t.Errorf("from = %s, want %s", got, tc.from)
			}
			if got := to.Format("2006-01-02"); got != tc.to {
				t.Errorf("to = %s, want %s", got, tc.to)
			}

			timezone, err := doc.GetTimezone()
			if err != nil {
				t.Fatal(err)
			}
			if timezone != "UTC+7" {
				t.Errorf("timezone = %q, want UTC+7", timezone)
			}

			currency, err := doc.GetCurrency()
			if err != nil {
				t.Fatal(err)
			}
			if currency != "IDR" {
				t.Errorf("currency = %q, want IDR", currency)
			}
		})
	}
}

// The order id is NOT a key: an order can settle and then reverse, both rows typed "Order"
// with the same id. Two samples contain exactly that.
func TestTiktokOrderIDIsNotAKeyButTheItemIs(t *testing.T) {
	for _, name := range []string{"overlapping_earning.xlsx", "pivan_fund_invalid.xlsx"} {
		t.Run(name, func(t *testing.T) {
			doc := openTiktokSample(t, name)

			items, err := doc.GetItems()
			if err != nil {
				t.Fatal(err)
			}

			ids := map[string]int{}
			keys := map[string]int{}
			for _, item := range items {
				ids[item.OrderRefID]++

				key, err := item.GenerateUniqueID()
				if err != nil {
					t.Fatal(err)
				}
				keys[key]++
			}

			repeated := 0
			for _, n := range ids {
				if n > 1 {
					repeated++
				}
			}
			if repeated == 0 {
				t.Fatal("expected this sample to settle one order twice")
			}

			for key, n := range keys {
				if n > 1 {
					t.Fatalf("unique id %s covers %d rows", key, n)
				}
			}
		})
	}
}

func TestTiktokUniqueIDDoesNotCollide(t *testing.T) {
	for _, name := range tiktokSampleNames(t) {
		t.Run(name, func(t *testing.T) {
			doc := openTiktokSample(t, name)

			items, err := doc.GetItems()
			if err != nil {
				t.Fatal(err)
			}

			seen := map[string]bool{}
			for _, item := range items {
				id, err := item.GenerateUniqueID()
				if err != nil {
					t.Fatal(err)
				}
				if seen[id] {
					t.Fatalf("duplicate unique id for %+v", item)
				}
				seen[id] = true
			}
		})
	}
}

// The whole reason the fee breakdown is not on the item: when the same order turns up in a
// second export, its key has to be the same, or every overlapping row imports twice.
func TestTiktokUniqueIDIsStableAcrossOverlappingExports(t *testing.T) {
	names := tiktokSampleNames(t)

	// order id -> settled date -> unique id, and the file it came from
	type seen struct {
		file string
		key  string
	}
	byOrder := map[string][]seen{}

	for _, name := range names {
		doc := openTiktokSample(t, name)
		items, err := doc.GetItems()
		if err != nil {
			t.Fatal(err)
		}

		for _, item := range items {
			key, err := item.GenerateUniqueID()
			if err != nil {
				t.Fatal(err)
			}
			at := item.OrderRefID + "@" + item.At.Format("2006-01-02")
			byOrder[at] = append(byOrder[at], seen{file: name, key: key})
		}
	}

	overlaps := 0
	for at, occurrences := range byOrder {
		files := map[string]bool{}
		for _, o := range occurrences {
			files[o.file] = true
		}
		if len(files) < 2 {
			continue
		}
		overlaps++

		for _, o := range occurrences[1:] {
			if o.key != occurrences[0].key {
				t.Errorf("%s hashes differently in %s and %s", at, occurrences[0].file, o.file)
			}
		}
	}

	if overlaps == 0 {
		t.Fatal("no order appears in two exports, so this proves nothing")
	}
	t.Logf("%d orders appear in more than one export, all stable", overlaps)
}

// Fee columns come and go between exports. They must be readable, and they must not be part of
// the key.
func TestTiktokColumnDriftDoesNotReachTheKey(t *testing.T) {
	narrow := openTiktokSample(t, "niko_lape.xlsx")   // 61 columns
	wide := openTiktokSample(t, "gmv_mlongo.xlsx")    // 64 columns
	middle := openTiktokSample(t, "salah_tarik.xlsx") // 63 columns

	narrowDrift, err := narrow.GetDriftingColumns()
	if err != nil {
		t.Fatal(err)
	}
	wideDrift, err := wide.GetDriftingColumns()
	if err != nil {
		t.Fatal(err)
	}
	middleDrift, err := middle.GetDriftingColumns()
	if err != nil {
		t.Fatal(err)
	}

	if len(narrowDrift) == len(wideDrift) && len(wideDrift) == len(middleDrift) {
		t.Fatal("expected the three layouts to carry different fee columns")
	}

	// "Flat fee" is in the narrow layout and absent from the widest — the direction that is
	// easy to miss, because a column DISAPPEARING looks like a parse failure.
	if !contains(narrowDrift, "Flat fee") {
		t.Error("niko_lape should carry Flat fee")
	}
	if contains(wideDrift, "Flat fee") {
		t.Error("gmv_mlongo should NOT carry Flat fee")
	}
	if !contains(wideDrift, "GMV Max ad fee") {
		t.Error("gmv_mlongo should carry GMV Max ad fee")
	}

	// The breakdown is still reachable, keyed by the row's unique id.
	details, err := wide.GetDetails()
	if err != nil {
		t.Fatal(err)
	}
	items, err := wide.GetItems()
	if err != nil {
		t.Fatal(err)
	}
	if len(details) != len(items) {
		t.Fatalf("details = %d, items = %d", len(details), len(items))
	}

	_, found := details[0].Columns["GMV Max ad fee"]
	if !found {
		t.Error("the drifting column is not readable through GetDetails")
	}
}

// The September 2026 layout renamed headers the reader relies on — "Type" became "Transaction
// type" on two sheets, "Order/adjustment ID" and "Order Source" changed case, and two Reports
// labels were respelled — across 76 columns where the widest earlier layout had 64.
//
// Opening is not enough: a renamed column the reader missed reads as "" or 0, so this checks the
// values landed.
func TestTiktokReadsTheSeptember2026Layout(t *testing.T) {
	doc := openTiktokSample(t, "cannot_open.xlsx")

	items, err := doc.GetItems()
	if err != nil {
		t.Fatal(err)
	}

	// The file's own totals, from its Reports sheet. Getting TikTok's figures back by summing the
	// columns the reader mapped is what proves they are the right columns.
	var amount, revenue, fees float64
	for _, item := range items {
		amount += item.Amount
		revenue += item.Revenue
		fees += item.TotalFees

		if item.TransactionType == "" {
			t.Errorf("order %s: no transaction type", item.OrderRefID)
		}
		if item.TransactionType == "Order" && item.Source == "" {
			t.Errorf("order %s: no source", item.OrderRefID)
		}
		// The adjustment row writes "none" as "/" followed by a TAB.
		if strings.Contains(item.RelatedOrderRefID, "/") {
			t.Errorf("order %s: related order %q is TikTok's none marker", item.OrderRefID, item.RelatedOrderRefID)
		}
	}
	if amount != 275545 || revenue != 348690 || fees != -83561 {
		t.Errorf("totals = %.0f / %.0f / %.0f, the Reports sheet says 275545 / 348690 / -83561",
			amount, revenue, fees)
	}

	withdrawals, err := doc.GetWithdrawals()
	if err != nil {
		t.Fatal(err)
	}
	for _, withdrawal := range withdrawals {
		if withdrawal.Type == "" {
			t.Errorf("withdrawal %s: no type", withdrawal.ReferenceID)
		}
	}

	drifting, err := doc.GetDriftingColumns()
	if err != nil {
		t.Fatal(err)
	}
	if !contains(drifting, "Growth Xtra Program service fee") {
		t.Error("the September 2026 layout should carry Growth Xtra Program service fee")
	}
	if contains(drifting, "Bonus cashback service fee") {
		t.Error("the September 2026 layout should NOT carry Bonus cashback service fee")
	}
}

// A column the reader cannot find fails the read, naming it. Read as "" or 0 instead, it would
// change every row's unique id and the next import would book the whole export twice.
//
// Built in memory rather than from a sample, so both spellings of every renamed column are
// covered even where the samples are not on disk.
func TestTiktokMissingColumnFailsInsteadOfReadingZero(t *testing.T) {
	orders := []string{
		"Order/adjustment ID", "Type", "Order created time", "Order settled time", "Currency",
		"Total settlement amount", "Total Revenue", "Total Fees", "Related order ID", "Order Source",
	}
	renamedOrders := []string{
		"Order/Adjustment ID", "Transaction type", "Order created time", "Order settled time", "Currency",
		"Total settlement amount", "Total Revenue", "Total Fees", "Related order ID", "Order source",
	}
	withdrawals := []string{"Type", "Reference ID", "Request time", "Amount", "Status", "Success time"}
	renamedWithdrawals := []string{"Transaction type", "Reference ID", "Request time", "Amount", "Status", "Success time"}

	without := func(header []string, name string) []string {
		kept := []string{}
		for _, column := range header {
			if column != name {
				kept = append(kept, column)
			}
		}
		return kept
	}

	cases := []struct {
		name   string
		sheets map[string][]string
		want   []string // in the error; none means the read succeeds
	}{
		{
			name:   "the earlier spellings",
			sheets: map[string][]string{"Order details": orders, "Withdrawal records": withdrawals},
		},
		{
			name:   "the September 2026 spellings",
			sheets: map[string][]string{"Order details": renamedOrders, "Withdrawal records": renamedWithdrawals},
		},
		{
			name:   "a money column is missing",
			sheets: map[string][]string{"Order details": without(orders, "Total Fees")},
			want:   []string{`"Order details"`, `"Total Fees"`},
		},
		{
			name:   "a renamed column under a spelling never seen",
			sheets: map[string][]string{"Order details": append(without(orders, "Type"), "Kind")},
			want:   []string{`"Type" or "Transaction type"`},
		},
		{
			name: "the withdrawal sheet lost a column",
			sheets: map[string][]string{
				"Order details":      orders,
				"Withdrawal records": without(withdrawals, "Amount"),
			},
			want: []string{`"Withdrawal records"`, `"Amount"`},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := san_excel_readers.NewTiktokSettlementDocument(tiktokWorkbook(t, tc.sheets))
			if len(tc.want) == 0 {
				if err != nil {
					t.Fatal(err)
				}
				return
			}

			if !errors.Is(err, san_excel_readers.ErrNotTiktokReport) {
				t.Fatalf("err = %v, want ErrNotTiktokReport", err)
			}
			for _, want := range tc.want {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("err = %v, want it to name %s", err, want)
				}
			}
		})
	}
}

// tiktokWorkbook builds an export in memory from sheet name to header row — enough to reach the
// column checks, which run before a single row is parsed.
func tiktokWorkbook(t *testing.T, sheets map[string][]string) *bytes.Buffer {
	t.Helper()

	file := excelize.NewFile()
	defer file.Close()

	for name, header := range sheets {
		_, err := file.NewSheet(name)
		if err != nil {
			t.Fatal(err)
		}

		err = file.SetSheetRow(name, "A1", &header)
		if err != nil {
			t.Fatal(err)
		}
	}

	buffer, err := file.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}

	return buffer
}

func contains(haystack []string, needle string) bool {
	for _, straw := range haystack {
		if straw == needle {
			return true
		}
	}
	return false
}

// SettlementType is a reserved signature with no body yet: the enum it returns is an empty
// heading in settlement/context.md, and TikTok has no mapping table at all. It panics, so this
// pins that it panics DELIBERATELY rather than through some later accident — and it is the test
// that must be rewritten, not deleted, when the mapping lands.
func TestSettlementTypeIsNotImplemented(t *testing.T) {
	// TikTok has no mapping table in context.md at all — Shopee's is implemented.
	item := san_excel_readers.TiktokSettlementItem{TransactionType: "Order"}
	assertPanics(t, func() { _, _ = item.SettlementType() })
}

func assertPanics(t *testing.T, call func()) {
	t.Helper()

	defer func() {
		recovered := recover()
		if recovered == nil {
			t.Fatal("SettlementType returned instead of panicking — if it is implemented now, rewrite this test")
		}

		message, ok := recovered.(string)
		if !ok || !strings.Contains(message, "not implemented") {
			t.Fatalf("panicked with %v, want a \"not implemented\" message", recovered)
		}
	}()

	call()
}

func TestTiktokUniqueIDEncodingIsPinned(t *testing.T) {
	item := san_excel_readers.TiktokSettlementItem{
		At:                time.Date(2025, 12, 24, 0, 0, 0, 0, san_excel_readers.WIB),
		CreatedAt:         time.Date(2025, 11, 29, 0, 0, 0, 0, san_excel_readers.WIB),
		TransactionType:   "Order",
		OrderRefID:        "581409655059350984",
		RelatedOrderRefID: "581409655059350984",
		Currency:          "IDR",
		Amount:            111598,
		Revenue:           136240,
		TotalFees:         -24642,
		Source:            "TikTok Shop",
	}

	id, err := item.GenerateUniqueID()
	if err != nil {
		t.Fatal(err)
	}

	const pinned = "b9409dbd4043787b34d0f6c2e1a6ecf9"
	if id != pinned {
		t.Fatalf("unique id encoding changed: got %s, pinned %s\n"+
			"If this is deliberate, every stored unique_id is invalidated — see "+
			"hash-the-whole-struct in docs/technical/packages/excel_readers/context_decision.md", id, pinned)
	}
}

// An 18-digit order id must survive as text. Through a float64 it would lose its last digits.
func TestTiktokOrderIDKeepsEveryDigit(t *testing.T) {
	doc := openTiktokSample(t, "niko_lape_full.xlsx")

	items, err := doc.GetItems()
	if err != nil {
		t.Fatal(err)
	}

	for _, item := range items {
		if len(item.OrderRefID) != 18 {
			continue
		}
		if item.OrderRefID[17] == '0' && item.OrderRefID[16] == '0' {
			t.Fatalf("order id %q looks rounded", item.OrderRefID)
		}
		return
	}

	t.Fatal("no 18-digit order id in the sample")
}

func TestNewTiktokSettlementDocumentRejectsAnotherPlatform(t *testing.T) {
	file, err := os.Open("../../../examples/settlement_samples/shopee/niko_lape.xlsx")
	if os.IsNotExist(err) {
		file, err = os.Open("../../../examples/settlement_samples/shopee/panic_violeta.xlsx")
	}
	if os.IsNotExist(err) {
		t.Skip("no shopee samples in this checkout")
	}
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	_, err = san_excel_readers.NewTiktokSettlementDocument(file)
	if !errors.Is(err, san_excel_readers.ErrNotTiktokReport) {
		t.Fatalf("err = %v, want ErrNotTiktokReport", err)
	}
}
