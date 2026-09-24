package san_excel_readers_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_excel_readers"
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

// Seven fee columns come and go between exports. They must be readable, and they must not be
// part of the key.
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

func contains(haystack []string, needle string) bool {
	for _, straw := range haystack {
		if straw == needle {
			return true
		}
	}
	return false
}

// SettlementType has no mapping table for TikTok and the enum it would map onto is an empty
// heading. Until that is written, the reader refuses rather than guesses.
func TestTiktokSettlementTypeIsNotMappedYet(t *testing.T) {
	doc := openTiktokSample(t, "niko_lape.xlsx")

	items, err := doc.GetItems()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) == 0 {
		t.Fatal("no items")
	}

	_, err = items[0].SettlementType()
	if !errors.Is(err, san_excel_readers.ErrNoSettlementTypeMapping) {
		t.Fatalf("err = %v, want ErrNoSettlementTypeMapping", err)
	}
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
