package san_excel_readers_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_excel_readers"
)

// The sample reports are real exports and live outside the package. Like san_testdb skipping
// when no database is reachable, these skip when the samples are not in the checkout.
const shopeeSamples = "../../../examples/settlement_samples/shopee"

func openShopeeSample(t *testing.T, name string) san_excel_readers.ShopeeSettlementDocument {
	t.Helper()

	file, err := os.Open(filepath.Join(shopeeSamples, name))
	if os.IsNotExist(err) {
		t.Skipf("sample %q is not in this checkout", name)
	}
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	doc, err := san_excel_readers.NewShopeeSettlementDocument(file)
	if err != nil {
		t.Fatalf("parsing %s: %v", name, err)
	}

	return doc
}

func shopeeSampleNames(t *testing.T) []string {
	t.Helper()

	entries, err := os.ReadDir(shopeeSamples)
	if os.IsNotExist(err) {
		t.Skip("no shopee samples in this checkout")
	}
	if err != nil {
		t.Fatal(err)
	}

	names := []string{}
	for _, entry := range entries {
		// A spreadsheet left open by another program drops a ".~lock.<name>#" beside it.
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".xlsx" || entry.Name()[0] == '.' {
			continue
		}
		names = append(names, entry.Name())
	}

	return names
}

// The counts and periods below were measured from the samples. The usernames deliberately are
// not asserted literally — they are real sellers, and this repository is public.
func TestShopeeSettlementDocument(t *testing.T) {
	cases := []struct {
		file  string
		items int
		from  string
		to    string
	}{
		{"awan_beban_return.xlsx", 1463, "2025-12-01", "2025-12-19"},
		{"awan_beban_return_simple.xlsx", 141, "2025-12-01", "2025-12-19"},
		{"awan_biaya_ams.xlsx", 337, "2026-02-01", "2026-02-04"},
		{"awan_wdgagal.xlsx", 433, "2026-02-01", "2026-02-21"},
		{"luxy_balance_sisa.xlsx", 368, "2025-11-20", "2025-12-20"},
		{"luxy_wdgagal.xlsx", 155, "2026-03-01", "2026-03-06"},
		{"mb_erna_err.xlsx", 40, "2026-02-16", "2026-02-19"},
		{"panic_violeta.xlsx", 23, "2025-12-19", "2025-12-20"},
		{"seluna_selesai_sisa.xlsx", 141, "2025-11-07", "2025-12-04"},
		{"shopee_malaysia.xlsx", 1, "2025-12-01", "2025-12-30"},
		{"shopee_malaysia_base.xlsx", 71, "2025-12-27", "2025-12-30"},
		{"shopee_wd_tidak_cocok.xlsx", 615, "2025-10-05", "2026-01-05"},
	}

	for _, tc := range cases {
		t.Run(tc.file, func(t *testing.T) {
			doc := openShopeeSample(t, tc.file)

			items, err := doc.GetItems()
			if err != nil {
				t.Fatal(err)
			}
			if len(items) != tc.items {
				t.Errorf("items = %d, want %d", len(items), tc.items)
			}

			username, err := doc.GetShopUsername()
			if err != nil {
				t.Fatal(err)
			}
			if username == "" {
				t.Error("no shop username read from the preamble")
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

			for _, item := range items {
				if item.At.IsZero() {
					t.Fatal("an item has no transaction time")
				}
				if _, offset := item.At.Zone(); offset != 7*60*60 {
					t.Fatalf("item at %s is not read at UTC+7", item.At)
				}
			}
		})
	}
}

// Shopee gives no per-row identifier, so the key is the whole row. Nothing in any sample may
// collide, or two real movements would import as one.
func TestShopeeUniqueIDDoesNotCollide(t *testing.T) {
	for _, name := range shopeeSampleNames(t) {
		t.Run(name, func(t *testing.T) {
			doc := openShopeeSample(t, name)

			items, err := doc.GetItems()
			if err != nil {
				t.Fatal(err)
			}

			seen := map[string]int{}
			for at, item := range items {
				id, err := item.GenerateUniqueID()
				if err != nil {
					t.Fatal(err)
				}

				first, clash := seen[id]
				if clash {
					t.Fatalf("items %d and %d share a unique id: %+v", first, at, item)
				}
				seen[id] = at
			}
		})
	}
}

// Two adjustments can share their timestamp, type, order ref AND amount. Only Deskripsi and
// Saldo Akhir tell them apart, which is why the whole item is hashed rather than a few fields.
func TestShopeeUniqueIDSeparatesIdenticalLookingRows(t *testing.T) {
	doc := openShopeeSample(t, "shopee_malaysia_base.xlsx")

	items, err := doc.GetItems()
	if err != nil {
		t.Fatal(err)
	}

	twins := []*san_excel_readers.ShopeeSettlementItem{}
	for _, item := range items {
		if item.Amount == -739 && item.At.Format("15:04:05") == "12:41:25" {
			twins = append(twins, item)
		}
	}
	if len(twins) != 2 {
		t.Fatalf("expected the 2 known look-alike rows, found %d", len(twins))
	}

	if twins[0].Description == twins[1].Description {
		t.Fatal("the look-alike rows should differ in Deskripsi")
	}

	first, err := twins[0].GenerateUniqueID()
	if err != nil {
		t.Fatal(err)
	}
	second, err := twins[1].GenerateUniqueID()
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("two distinct movements produced the same unique id")
	}
}

// The same report re-saved by another spreadsheet program stores its money as numbers instead
// of text. The key must not notice: a re-upload has to be recognised as the same rows.
func TestShopeeUniqueIDSurvivesAReSave(t *testing.T) {
	original := openShopeeSample(t, "awan_beban_return.xlsx")
	resaved := openShopeeSample(t, "awan_beban_return_simple.xlsx")

	originalItems, err := original.GetItems()
	if err != nil {
		t.Fatal(err)
	}
	resavedItems, err := resaved.GetItems()
	if err != nil {
		t.Fatal(err)
	}

	known := map[string]bool{}
	for _, item := range originalItems {
		id, err := item.GenerateUniqueID()
		if err != nil {
			t.Fatal(err)
		}
		known[id] = true
	}

	for at, item := range resavedItems {
		id, err := item.GenerateUniqueID()
		if err != nil {
			t.Fatal(err)
		}
		if !known[id] {
			t.Fatalf("re-saved item %d has a different unique id: %+v", at, item)
		}
	}
}

// A "No. Pesanan" of "-" means the movement has no order — a withdrawal, usually. It must not
// reach a caller as an order reference called "-".
func TestShopeeDashIsNotAnOrderReference(t *testing.T) {
	doc := openShopeeSample(t, "shopee_wd_tidak_cocok.xlsx")

	items, err := doc.GetItems()
	if err != nil {
		t.Fatal(err)
	}

	empty := 0
	for _, item := range items {
		if item.OrderRefID == "-" {
			t.Fatalf("a literal %q reached OrderRefID: %+v", "-", item)
		}
		if item.OrderRefID == "" {
			empty++
		}
	}

	if empty != 116 {
		t.Errorf("items with no order reference = %d, want 116", empty)
	}
}

// GenerateUniqueID is an idempotency key that gets STORED, so its encoding is a contract: the
// field set, their json names, their order, the time format and the number format all feed the
// digest. This pins that encoding against a synthetic row, so a change to any of them fails
// here rather than silently re-importing every settlement ever recorded.
func TestShopeeUniqueIDEncodingIsPinned(t *testing.T) {
	item := san_excel_readers.ShopeeSettlementItem{
		At:          time.Date(2025, 12, 30, 8, 37, 10, 0, san_excel_readers.WIB),
		Type:        san_excel_readers.ShopeeWithdrawal,
		Description: "Penarikan Dana",
		OrderRefID:  "",
		Amount:      -3282762,
		LastBalance: 0,
	}

	id, err := item.GenerateUniqueID()
	if err != nil {
		t.Fatal(err)
	}

	const pinned = "d696930249ed94479f0ec7efbd4d5ff7"
	if id != pinned {
		t.Fatalf("unique id encoding changed: got %s, pinned %s\n"+
			"If this is deliberate, every stored unique_id is invalidated — see "+
			"hash-the-whole-struct in docs/technical/packages/excel_readers/context_decision.md", id, pinned)
	}
}

func TestNewShopeeSettlementDocumentRejectsAnotherPlatform(t *testing.T) {
	file, err := os.Open("../../../examples/settlement_samples/tiktok/niko_lape.xlsx")
	if os.IsNotExist(err) {
		t.Skip("no tiktok samples in this checkout")
	}
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	_, err = san_excel_readers.NewShopeeSettlementDocument(file)
	if !errors.Is(err, san_excel_readers.ErrNotShopeeReport) {
		t.Fatalf("err = %v, want ErrNotShopeeReport", err)
	}
}

// The mapping table from context.md, keyed on "Tipe Transaksi" alone.
func TestShopeeSettlementType(t *testing.T) {
	cases := []struct {
		transaction san_excel_readers.ShopeeSettlementType
		want        san_excel_readers.SettlementType
	}{
		{san_excel_readers.ShopeeWithdrawal, "withdrawal"},
		{san_excel_readers.ShopeeOrderIncome, "fund"},
		{san_excel_readers.ShopeeAdjustment, "marketplace_adjustment"},
		{san_excel_readers.ShopeeFlexiExport, "marketplace_program"},
		{san_excel_readers.ShopeeBalancePayment, "marketplace_adjustment"},
	}

	for _, tc := range cases {
		t.Run(string(tc.transaction), func(t *testing.T) {
			item := san_excel_readers.ShopeeSettlementItem{Type: tc.transaction}

			got, err := item.SettlementType()
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Errorf("SettlementType() = %q, want %q", got, tc.want)
			}
		})
	}
}

// The sign is not part of the classification. A FAILED withdrawal is refunded by a second
// "Penarikan Dana" row with a POSITIVE amount, and both are withdrawal — the pair nets to zero
// because the changes do, not because the types differ.
func TestShopeeSettlementTypeIgnoresTheSign(t *testing.T) {
	out := san_excel_readers.ShopeeSettlementItem{Type: san_excel_readers.ShopeeWithdrawal, Amount: -5899085}
	back := san_excel_readers.ShopeeSettlementItem{Type: san_excel_readers.ShopeeWithdrawal, Amount: 5899085}

	outType, err := out.SettlementType()
	if err != nil {
		t.Fatal(err)
	}
	backType, err := back.SettlementType()
	if err != nil {
		t.Fatal(err)
	}

	if outType != backType {
		t.Fatalf("a withdrawal and its refund classified differently: %q vs %q", outType, backType)
	}
}

// An unmapped type is an error, never "other" — bucketing a new platform behaviour into "other"
// is how it gets imported silently for months.
func TestShopeeSettlementTypeRefusesAnUnmappedType(t *testing.T) {
	for _, transaction := range []san_excel_readers.ShopeeSettlementType{
		"Something Shopee Invents Next Quarter",
		"",
	} {
		item := san_excel_readers.ShopeeSettlementItem{Type: transaction}

		_, err := item.SettlementType()
		if !errors.Is(err, san_excel_readers.ErrNoSettlementTypeMapping) {
			t.Errorf("%q: err = %v, want ErrNoSettlementTypeMapping", transaction, err)
		}
	}
}

// Every transaction type in every sample maps — there is no gap left. This fails the day a real
// export carries something the table has never seen.
func TestShopeeSettlementTypeCoversTheSamples(t *testing.T) {
	unmapped := map[san_excel_readers.ShopeeSettlementType]int{}

	for _, name := range shopeeSampleNames(t) {
		doc := openShopeeSample(t, name)

		items, err := doc.GetItems()
		if err != nil {
			t.Fatal(err)
		}

		for _, item := range items {
			_, err := item.SettlementType()
			if err != nil {
				unmapped[item.Type]++
			}
		}
	}

	if len(unmapped) != 0 {
		t.Fatalf("transaction types with no mapping: %v", unmapped)
	}
}

// Every item has its detail, in the same order and under the same key — the importer reads a row's
// Status off it (only-a-successful-withdrawal-is-recorded) without the Status ever reaching the hash.
func TestShopeeDetailsFollowTheItems(t *testing.T) {
	for _, name := range shopeeSampleNames(t) {
		doc := openShopeeSample(t, name)

		items, _ := doc.GetItems()
		details, _ := doc.GetDetails()

		if len(details) != len(items) {
			t.Fatalf("%s: %d details for %d items", name, len(details), len(items))
		}

		for i, item := range items {
			key, err := item.GenerateUniqueID()
			if err != nil {
				t.Fatal(err)
			}

			if details[i].UniqueID != key {
				t.Fatalf("%s row %d: detail key %s, item key %s", name, i, details[i].UniqueID, key)
			}

			if details[i].Status == "" || details[i].Direction == "" {
				t.Fatalf("%s row %d: no Status or Jenis Transaksi read", name, i)
			}
		}
	}
}

// Both failed-withdrawal samples carry exactly one Gagal debit, and its refund — money coming back,
// itself "Transaksi Selesai" — is a positive Penarikan Dana a caller can tell apart by its sign.
func TestShopeeAFailedWithdrawalIsReadableOffTheDetail(t *testing.T) {
	for _, name := range []string{"awan_wdgagal.xlsx", "luxy_wdgagal.xlsx"} {
		doc := openShopeeSample(t, name)

		items, _ := doc.GetItems()
		details, _ := doc.GetDetails()

		failed, refunds := 0, 0

		for i, item := range items {
			if item.Type != san_excel_readers.ShopeeWithdrawal {
				continue
			}

			if details[i].Status == "Gagal" {
				failed++
			}

			if item.Amount > 0 {
				refunds++

				if details[i].Status != "Transaksi Selesai" {
					t.Errorf("%s: the refund reads %q", name, details[i].Status)
				}
			}
		}

		if failed != 1 || refunds != 1 {
			t.Fatalf("%s: %d Gagal withdrawals and %d refunds, want 1 and 1", name, failed, refunds)
		}
	}
}
