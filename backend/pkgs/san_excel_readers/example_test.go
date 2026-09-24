package san_excel_readers_test

import (
	"bytes"
	"errors"
	"fmt"
	"log"
	"os"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_excel_readers"
)

// These examples are compiled by `go test`, so they cannot drift from the API. They have no
// "Output:" comment on purpose — that makes them compile-checked without needing a sample
// workbook on disk.

// Reading a Shopee "Transaction Report": one row per movement on the seller wallet.
func ExampleNewShopeeSettlementDocument() {
	file, err := os.Open("settlement.xlsx")
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()

	doc, err := san_excel_readers.NewShopeeSettlementDocument(file)
	if err != nil {
		log.Fatal(err)
	}

	username, err := doc.GetShopUsername()
	if err != nil {
		log.Fatal(err)
	}

	from, to, err := doc.GetPeriod()
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("%s: %s to %s\n", username, from.Format("2006-01-02"), to.Format("2006-01-02"))

	items, err := doc.GetItems()
	if err != nil {
		log.Fatal(err)
	}

	for _, item := range items {
		// The key to store against, so re-uploading an overlapping export is a no-op.
		id, err := item.GenerateUniqueID()
		if err != nil {
			log.Fatal(err)
		}

		fmt.Printf("%s %s %s %.0f (balance %.0f)\n",
			id, item.At.Format("2006-01-02 15:04:05"), item.Type, item.Amount, item.LastBalance)
	}
}

// Reading a TikTok export: orders on one sheet, the money moving on another.
func ExampleNewTiktokSettlementDocument() {
	file, err := os.Open("tiktok.xlsx")
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()

	doc, err := san_excel_readers.NewTiktokSettlementDocument(file)
	if err != nil {
		log.Fatal(err)
	}

	// "Order details" — what each order was WORTH.
	items, err := doc.GetItems()
	if err != nil {
		log.Fatal(err)
	}
	for _, item := range items {
		fmt.Printf("order %s settled %s for %.0f (fees %.0f)\n",
			item.OrderRefID, item.At.Format("2006-01-02"), item.Amount, item.TotalFees)
	}

	// "Withdrawal records" — where the money actually MOVES. Not the same thing.
	withdrawals, err := doc.GetWithdrawals()
	if err != nil {
		log.Fatal(err)
	}
	for _, w := range withdrawals {
		fmt.Printf("%s %s %.0f %s\n", w.Type, w.At.Format("2006-01-02"), w.Amount, w.Status)
	}
}

// The fee breakdown is NOT on the item, because fee columns come and go between exports and the
// item is its own idempotency key. It is reachable by that key instead.
func ExampleTiktokSettlementDocument_getDetails() {
	file, err := os.Open("tiktok.xlsx")
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()

	doc, err := san_excel_readers.NewTiktokSettlementDocument(file)
	if err != nil {
		log.Fatal(err)
	}

	details, err := doc.GetDetails()
	if err != nil {
		log.Fatal(err)
	}

	byKey := map[string]map[string]string{}
	for _, detail := range details {
		byKey[detail.UniqueID] = detail.Columns
	}

	items, err := doc.GetItems()
	if err != nil {
		log.Fatal(err)
	}

	for _, item := range items {
		id, err := item.GenerateUniqueID()
		if err != nil {
			log.Fatal(err)
		}

		// Any column, by the header text the file uses.
		commission := byKey[id]["Platform commission fee"]
		fmt.Printf("%s commission %s\n", item.OrderRefID, commission)
	}

	// The fee columns this export carries that not every export does — a caller comparing fees
	// across exports cannot assume the other one has them. Informational, never an error.
	drifting, err := doc.GetDriftingColumns()
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("drifting fee columns:", drifting)
}

// Which reader to use, when the upload does not say which platform it came from.
func ExampleNewShopeeSettlementDocument_detect() {
	raw, err := os.ReadFile("unknown.xlsx")
	if err != nil {
		log.Fatal(err)
	}

	shopee, err := san_excel_readers.NewShopeeSettlementDocument(bytes.NewReader(raw))
	if err == nil {
		items, _ := shopee.GetItems()
		fmt.Println("shopee,", len(items), "movements")
		return
	}
	if !errors.Is(err, san_excel_readers.ErrNotShopeeReport) {
		log.Fatal(err) // a real failure — corrupt file, unreadable zip
	}

	tiktok, err := san_excel_readers.NewTiktokSettlementDocument(bytes.NewReader(raw))
	if err == nil {
		items, _ := tiktok.GetItems()
		fmt.Println("tiktok,", len(items), "orders")
		return
	}
	if !errors.Is(err, san_excel_readers.ErrNotTiktokReport) {
		log.Fatal(err)
	}

	fmt.Println("neither platform")
}

// A transaction type the package has never seen is still parsed — it is not an error. Known()
// is there so a caller can notice and flag it rather than fail the upload.
func ExampleShopeeSettlementType_Known() {
	seen := san_excel_readers.ShopeeSettlementType("Program Ekspor Shopee FLEXI")
	unseen := san_excel_readers.ShopeeSettlementType("Something TikTok Invented Last Week")

	fmt.Println(seen.Known(), unseen.Known())
	// Output: true false
}
