package order_import_readers_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/order_import_readers"
)

// sample is a file from examples/order_samples — the mocks the readers are built against.
func sample(t *testing.T, platform, name string) []byte {
	t.Helper()

	content, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "examples", "order_samples", platform, name))
	if err != nil {
		t.Fatalf("read the sample: %v", err)
	}

	return content
}

// byRef indexes a read file, and fails on a ref read twice — one order per ref is the readers' first promise.
func byRef(t *testing.T, orders []order_import_readers.Order) map[string]order_import_readers.Order {
	t.Helper()

	out := map[string]order_import_readers.Order{}
	for _, order := range orders {
		if _, dup := out[order.Ref]; dup {
			t.Fatalf("ref %s read twice", order.Ref)
		}

		out[order.Ref] = order
	}

	return out
}

func wantStatus(t *testing.T, got map[string]order_import_readers.Order, ref string, want order_import_readers.Status) {
	t.Helper()

	order, ok := got[ref]
	if !ok {
		t.Fatalf("ref %s not read", ref)
	}

	if order.Status != want {
		t.Fatalf("ref %s (%s) read as %d, want %d", ref, order.Words, order.Status, want)
	}
}

// One order per No. Pesanan however many products it has, each Shopee word read, in the file's order.
func TestReadShopee_OneOrderPerRefAndEveryWord(t *testing.T) {
	orders, err := order_import_readers.ReadShopee(sample(t, "shopee", "mock_order_all_20261020_20261023.xlsx"))
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	if len(orders) != 8 {
		t.Fatalf("read %d orders, want 8 — the file has 10 product rows for 8 orders", len(orders))
	}

	got := byRef(t, orders)
	wantStatus(t, got, "2610201A2B3C4D", order_import_readers.StatusCompleted)
	wantStatus(t, got, "2610201E5F6G7H", order_import_readers.StatusInTransit)
	wantStatus(t, got, "2610212N1P2Q3R", order_import_readers.StatusBeforeHandover)
	wantStatus(t, got, "2610223W7X8Y9Z", order_import_readers.StatusBeforeHandover)
	wantStatus(t, got, "2610224A1C3E5G", order_import_readers.StatusCancelled)

	// The second product row of 2610201E5F6G7H is row 4; the order is reported at its first, row 3.
	if row := got["2610201E5F6G7H"].Row; row != 3 {
		t.Fatalf("2610201E5F6G7H at row %d, want 3", row)
	}
}

// A returned Shopee order still says Selesai — the return is read from its own column.
func TestReadShopee_AReturnIsReadFromItsOwnColumn(t *testing.T) {
	orders, err := order_import_readers.ReadShopee(sample(t, "shopee", "mock_order_all_20261020_20261027.xlsx"))
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	got := byRef(t, orders)
	wantStatus(t, got, "2610212J8K9L0M", order_import_readers.StatusReturn)
	wantStatus(t, got, "2610235H7J9K2L", order_import_readers.StatusCancelled)

	if words := got["2610212J8K9L0M"].Words; words != "Selesai · Pengembalian Dana Disetujui" {
		t.Fatalf("words %q", words)
	}
}

// TikTok's description row under the header is not an order, and Shipped · Delivered has arrived.
func TestReadTiktok_SkipsTheDescriptionRowAndReadsTheSubstatus(t *testing.T) {
	orders, err := order_import_readers.ReadTiktok(sample(t, "tiktok", "mock_all_orders_20261020_20261023.xlsx"))
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	if len(orders) != 7 {
		t.Fatalf("read %d orders, want 7", len(orders))
	}

	got := byRef(t, orders)
	wantStatus(t, got, "582034417702156311", order_import_readers.StatusCompleted)
	wantStatus(t, got, "582035120938471122", order_import_readers.StatusCompleted)
	wantStatus(t, got, "582046653120988733", order_import_readers.StatusInTransit)
	wantStatus(t, got, "582047009875512344", order_import_readers.StatusBeforeHandover)
	wantStatus(t, got, "582059902761134466", order_import_readers.StatusBeforeHandover)
	wantStatus(t, got, "582060177345209877", order_import_readers.StatusCancelled)
}

func TestReadTiktok_AReturnIsReadFromItsOwnColumn(t *testing.T) {
	orders, err := order_import_readers.ReadTiktok(sample(t, "tiktok", "mock_all_orders_20261020_20261027.xlsx"))
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	wantStatus(t, byRef(t, orders), "582046653120988733", order_import_readers.StatusReturn)
}

// The other platform's file is refused as a whole, before any order is read.
func TestRead_TheOtherPlatformsFileIsRefused(t *testing.T) {
	_, err := order_import_readers.ReadTiktok(sample(t, "shopee", "mock_order_all_20261020_20261023.xlsx"))
	if !errors.Is(err, order_import_readers.ErrNotThisExport) {
		t.Fatalf("a Shopee file read as TikTok: %v, want ErrNotThisExport", err)
	}

	_, err = order_import_readers.ReadShopee(sample(t, "tiktok", "mock_all_orders_20261020_20261023.xlsx"))
	if !errors.Is(err, order_import_readers.ErrNotThisExport) {
		t.Fatalf("a TikTok file read as Shopee: %v, want ErrNotThisExport", err)
	}

	// A statement is not an order export either.
	statement, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "examples", "settlement_samples", "shopee", "awan_beban_return_simple.xlsx"))
	if err != nil {
		t.Skipf("no settlement sample: %v", err)
	}

	_, err = order_import_readers.ReadShopee(statement)
	if !errors.Is(err, order_import_readers.ErrNotThisExport) {
		t.Fatalf("a Shopee statement read as an order export: %v, want ErrNotThisExport", err)
	}
}

// A .csv export reads the same, a byte-order mark included; a word no reader knows is Unknown, never a guess.
func TestReadTiktok_ACsvAndAnUnknownWord(t *testing.T) {
	csv := "\xEF\xBB\xBFOrder ID,Order Status,Order Substatus,Cancelation/Return Type\n" +
		"Platform unique order ID.,The current status of the order.,,\n" +
		"582000000000000001,Shipped,In transit,\n" +
		"582000000000000002,Lost in space,,\n"

	orders, err := order_import_readers.ReadTiktok([]byte(csv))
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	got := byRef(t, orders)
	if len(got) != 2 {
		t.Fatalf("read %d orders, want 2", len(got))
	}

	wantStatus(t, got, "582000000000000001", order_import_readers.StatusInTransit)
	wantStatus(t, got, "582000000000000002", order_import_readers.StatusUnknown)
}
