package san_excel_readers_test

import (
	"bytes"
	"errors"
	"math"
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

// The TikTok table is filled one owner decision at a time, so this pins both halves: what is
// mapped stays mapped, and what is not still REFUSES rather than guessing at "other".
func TestTiktokSettlementType(t *testing.T) {
	mapped := map[string]san_excel_readers.SettlementType{
		"Order":                                     "fund",
		"Logistics reimbursement":                   "logistic_reimbursement",
		"Platform reimbursement":                    "platform_reimbursement",
		"GMV Payment for TikTok Ads":                "external_ads_fee",
		"GMV payment for TikTok Ads":                "external_ads_fee", // TikTok respelled it
		"Other adjustment":                          "marketplace_adjustment",
		"Marketing benefits package fee":            "marketplace_adjustment",
		"Additional marketing benefits package fee": "marketplace_adjustment",
		"Platform commission adjustment":            "marketplace_adjustment",
		"Deductions incurred by seller":             "marketplace_adjustment",
		"Adjustment from settlement account":        "marketplace_adjustment",
		// ⚠ FULLWIDTH parens, U+FF08/U+FF09 — escaped so a retype cannot pass unnoticed.
		"Violation fee （settlement fee）":  "marketplace_adjustment",
		"Violation fee (settlement fee)":  "marketplace_adjustment",
		"Shipping insurance compensation": "shipment_adjustment",
	}

	for transaction, want := range mapped {
		item := san_excel_readers.TiktokSettlementItem{TransactionType: transaction}

		got, err := item.SettlementType()
		if err != nil {
			t.Fatalf("%q: %v", transaction, err)
		}
		if got != want {
			t.Errorf("%q: SettlementType() = %q, want %q", transaction, got, want)
		}
	}

	for _, transaction := range []string{
		"Additional Campaign Package",
		"Something TikTok Invents Next Quarter",
	} {
		item := san_excel_readers.TiktokSettlementItem{TransactionType: transaction}

		_, err := item.SettlementType()
		if !errors.Is(err, san_excel_readers.ErrNoSettlementTypeMapping) {
			t.Errorf("%q: err = %v, want ErrNoSettlementTypeMapping", transaction, err)
		}
	}
}

// Every transaction type in the samples must EITHER map or be listed here as knowingly unmapped.
//
// ⚠ The "or" is the point. An earlier version only asserted the set was recognised, which let a
// type sit in neither bucket: "GMV Payment for TikTok Ads" was decided, the edit adding it to the
// table silently did not apply, and this test still passed because the type was on its
// known-but-unmapped list. A type that is neither mapped nor deliberately parked now fails here.
func TestTiktokSampleTransactionTypesAreAccountedFor(t *testing.T) {
	// Deliberately unmapped — each awaiting an owner decision, not an oversight.
	parked := map[string]string{
		"Additional Campaign Package": "ads fee or programme, genuinely unclear",
		"wderror":                     "almost certainly a hand-edited fixture in salah_tarik.xlsx",
	}

	unaccounted := map[string]int{}
	for _, name := range tiktokSampleNames(t) {
		doc := openTiktokSample(t, name)

		items, err := doc.GetItems()
		if err != nil {
			t.Fatal(err)
		}

		for _, item := range items {
			_, err := item.SettlementType()
			if err == nil {
				continue // mapped
			}

			_, expected := parked[item.TransactionType]
			if !expected {
				unaccounted[item.TransactionType]++
			}
		}
	}

	if len(unaccounted) != 0 {
		t.Fatalf("transaction types that are neither mapped nor knowingly parked: %v", unaccounted)
	}

	// And a parked type that has since been mapped should leave the list rather than linger.
	for transaction, why := range parked {
		item := san_excel_readers.TiktokSettlementItem{TransactionType: transaction}

		_, err := item.SettlementType()
		if err == nil {
			t.Errorf("%q is mapped now — drop it from parked (%s)", transaction, why)
		}
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

// An order that settled to ZERO is still a real row: 53 of the 2710 sampled "Order" rows have a
// settlement amount, revenue and fees all of 0 — a sale fully refunded before it paid out. They
// classify as fund like any other order, and it is the CALLER that decides whether a zero-change
// settlement log entry is worth writing.
func TestTiktokZeroSettlementIsStillAnOrder(t *testing.T) {
	doc := openTiktokSample(t, "pay_deduction.xlsx")

	items, err := doc.GetItems()
	if err != nil {
		t.Fatal(err)
	}

	zero := 0
	for _, item := range items {
		if item.Amount != 0 {
			continue
		}
		zero++

		got, err := item.SettlementType()
		if err != nil {
			t.Fatalf("a zero-amount order did not classify: %v", err)
		}
		if got != "fund" {
			t.Errorf("SettlementType() = %q, want fund", got)
		}
	}

	if zero == 0 {
		t.Fatal("expected this sample to contain orders settling zero")
	}
}

// Only an "Order" row carries an ORDER id. Everything else carries a 19-digit ADJUSTMENT id and
// points at the order it adjusts through RelatedOrderRefID — so a caller that keys on OrderRefID
// alone files every reimbursement against an order that does not exist.
func TestTiktokAdjustmentsCarryAnAdjustmentID(t *testing.T) {
	orders, adjustments, shopLevel := 0, 0, 0

	for _, name := range tiktokSampleNames(t) {
		doc := openTiktokSample(t, name)

		items, err := doc.GetItems()
		if err != nil {
			t.Fatal(err)
		}

		for _, item := range items {
			if item.TransactionType == "wderror" {
				continue // a hand-edited fixture, 28 characters and no related order
			}

			if item.TransactionType == "Order" {
				orders++
				if item.OrderRefID != item.RelatedOrderRefID {
					t.Errorf("order %s: RelatedOrderRefID is %s, expected them equal",
						item.OrderRefID, item.RelatedOrderRefID)
				}
				if len(item.OrderRefID) != 18 {
					t.Errorf("order id %q is %d digits, expected 18", item.OrderRefID, len(item.OrderRefID))
				}
				continue
			}

			adjustments++
			if item.OrderRefID == item.RelatedOrderRefID {
				t.Errorf("%s %s: adjustment id equals the related order id",
					item.TransactionType, item.OrderRefID)
			}
			if item.RelatedOrderRefID == "" {
				// Not a failure: the platform charged or paid the SHOP, not an order. This is
				// settlement_service's order_id-less case arriving from the file.
				shopLevel++
			}
		}
	}

	if orders == 0 || adjustments == 0 {
		t.Fatalf("orders=%d adjustments=%d, expected both", orders, adjustments)
	}
	if shopLevel == 0 {
		t.Error("expected some adjustments to have no related order at all")
	}
	t.Logf("%d orders, %d adjustments, %d of them shop-level with no order", orders, adjustments, shopLevel)
}

// The lookup folds case, so two table entries differing only in capitals would silently shadow
// each other. Nothing should ever be added that collides.
func TestTiktokSettlementTypeTableHasNoCaseCollisions(t *testing.T) {
	seen := map[string]string{}

	for _, transaction := range san_excel_readers.TiktokTransactionTypes() {
		folded := strings.ToLower(transaction)

		first, clash := seen[folded]
		if clash {
			t.Errorf("%q and %q differ only in case", first, transaction)
		}
		seen[folded] = transaction
	}
}

// A "Withdrawal records" row is where TikTok money actually moves. Only the Withdrawal type is
// mapped; see tiktokWithdrawalTypes for why Earnings deliberately is not.
func TestTiktokWithdrawalSettlementType(t *testing.T) {
	withdrawal := san_excel_readers.TiktokWithdrawalItem{Type: "Withdrawal"}

	got, err := withdrawal.SettlementType()
	if err != nil {
		t.Fatal(err)
	}
	if got != "withdrawal" {
		t.Errorf("SettlementType() = %q, want withdrawal", got)
	}

	for _, unmapped := range []string{"Earnings", "GMV Pay Deduction", "Something New"} {
		item := san_excel_readers.TiktokWithdrawalItem{Type: unmapped}

		_, err := item.SettlementType()
		if !errors.Is(err, san_excel_readers.ErrNoSettlementTypeMapping) {
			t.Errorf("%q: err = %v, want ErrNoSettlementTypeMapping", unmapped, err)
		}
	}
}

// ⚠ The reason Earnings must not be booked: it is the SAME money as the Order details sheet,
// totalled per day. Where the two totals agree at all, they agree exactly — so a caller that books
// both sheets as fund doubles its revenue.
func TestTiktokEarningsDuplicateTheOrderSettlements(t *testing.T) {
	exact := 0

	for _, name := range tiktokSampleNames(t) {
		doc := openTiktokSample(t, name)

		items, err := doc.GetItems()
		if err != nil {
			t.Fatal(err)
		}
		withdrawals, err := doc.GetWithdrawals()
		if err != nil {
			t.Fatal(err)
		}

		orders := 0.0
		for _, item := range items {
			orders += item.Amount
		}

		earnings := 0.0
		for _, w := range withdrawals {
			if w.Type == "Earnings" {
				earnings += w.Amount
			}
		}

		if math.Abs(orders-earnings) < 1 {
			exact++
		}
	}

	if exact < 8 {
		t.Fatalf("Earnings matched the order settlements exactly in only %d files — "+
			"if that is no longer true, the double-counting warning needs re-checking", exact)
	}
	t.Logf("Earnings equals the order settlement total exactly in %d of the samples", exact)
}
