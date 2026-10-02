package settlement_importer_v1_test

import (
	"strings"
	"testing"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_importer_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_v1"
)

// aTiktokWeek is one week of a TikTok shop:
//
//	Order details
//	  5770001  Order, commission −2.500 −500, its order found  → fund 100.000 + affiliate_fee −3.000
//	  5770002  Order, no commission, no such order              → fund 50.000, to the shop
//	  7770003  Logistics reimbursement of 5770001               → to 5770001's order
//	  7770004  Platform reimbursement, no related order          → to the shop
//	  7770005  a type nobody has mapped                          → HELD
//	Withdrawal records
//	  WD1  Withdrawal, Transferred                               → withdrawal
//	  WD2  Withdrawal, still processing                          → SKIPPED
//	  E1   Earnings                                              → SKIPPED, repeats the orders
//	  G1   GMV Pay Deduction                                     → SKIPPED, repeats the ads rows
func aTiktokWeek(t *testing.T) []byte {
	t.Helper()

	return tiktokStatement(t, "IDR", false,
		[]tiktokOrder{
			{"5770001", "Order", "5770001", "2026/09/03", "97000", "-2500", "-500"},
			{"5770002", "Order", "5770002", "2026/09/03", "50000", "0", "0"},
			{"7770003", "Logistics reimbursement", "5770001", "2026/09/04", "8000", "", ""},
			{"7770004", "Platform reimbursement", "/", "2026/09/04", "12000", "", ""},
			{"7770005", "Seller shipping fee compensation", "/", "2026/09/05", "6000", "", ""},
		},
		[]tiktokWithdrawal{
			{"Withdrawal", "WD1", "2026/09/05", "-120000", "Transferred"},
			{"Withdrawal", "WD2", "2026/09/06", "-10000", "Processing"},
			{"Earnings", "E1", "2026/09/05", "147000", "Transferred"},
			{"GMV Pay Deduction", "G1", "2026/09/05", "-3000", "Transferred"},
		},
	)
}

// A TikTok statement, end to end: an order's affiliate commission posts as its own row beside a fund that
// carries the payout before it (tiktok-affiliate-commission-posts-as-affiliate-fee), every row is looked
// up by Related order ID (a-tiktok-row-finds-its-order-by-related-order-id), only a transferred
// withdrawal posts, and the rows that repeat the orders are skipped.
func TestTiktokSettlementImport_PostsOrdersCommissionsAndWithdrawals(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)
	w.orders.byRef["5770001"] = []settlement_importer_v1.OrderRef{{OrderID: 801, ShopID: tiktokShop, CreatedByUserID: orderMaker}}

	messages := w.importTiktok(t, tiktokShop, aTiktokWeek(t))

	end := last(messages)
	if end.text != "Done — 6 posted, 0 already there, 1 held, 3 skipped" {
		t.Fatalf("the import ended %q", end.text)
	}

	// Ten rows from nine lines: the commission is a row of its own.
	if end.count != 10 {
		t.Fatalf("count = %d, want 10", end.count)
	}

	posts := w.ledger.posted()
	if len(posts) != 6 {
		t.Fatalf("%d posts, want 6: %+v", len(posts), posts)
	}

	fund, fee := posts[0], posts[1]

	if fund.SettlementType != settlementv1.SettlementType_SETTLEMENT_TYPE_FUND || fund.Change != 100_000 ||
		fund.OrderID != 801 || fund.CreatedByUserID != orderMaker || fund.OccurredOn != "2026-09-03" ||
		!strings.HasPrefix(fund.UniqueID, "tiktok:order_details:") {
		t.Errorf("the fund = %+v, want 100.000 — the payout before the commission", fund)
	}

	if fee.SettlementType != settlementv1.SettlementType_SETTLEMENT_TYPE_AFFILIATE_FEE || fee.Change != -3_000 ||
		fee.OrderID != 801 || fee.UniqueID != fund.UniqueID+":affiliate_fee" {
		t.Errorf("the commission = %+v, want −3.000 under the fund's key plus :affiliate_fee", fee)
	}

	if fund.Change+fee.Change != 97_000 {
		t.Error("the fund and its commission must still sum to TikTok's Total settlement amount")
	}

	if posts[2].OrderID != 0 || posts[2].Change != 50_000 {
		t.Errorf("an order row with no such order posts to the shop: %+v", posts[2])
	}

	if posts[3].SettlementType != settlementv1.SettlementType_SETTLEMENT_TYPE_LOGISTIC_REIMBURSEMENT || posts[3].OrderID != 801 {
		t.Errorf("an adjustment finds its order by Related order ID: %+v", posts[3])
	}

	if posts[4].SettlementType != settlementv1.SettlementType_SETTLEMENT_TYPE_PLATFORM_REIMBURSEMENT || posts[4].OrderID != 0 {
		t.Errorf("an adjustment with no related order posts to the shop: %+v", posts[4])
	}

	if posts[5].SettlementType != settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL || posts[5].Change != -120_000 ||
		!strings.HasPrefix(posts[5].UniqueID, "tiktok:withdrawal_records:") {
		t.Errorf("the transferred withdrawal = %+v", posts[5])
	}

	// The lookup asked for Related order IDs — 5770001 once, 5770002 — and never for an adjustment's own id.
	for _, ref := range w.orders.asked[0] {
		if strings.HasPrefix(ref, "777") {
			t.Errorf("the lookup asked for adjustment id %s — an adjustment's own id names no order", ref)
		}
	}

	file := fileRows(t, db)[0]
	lines := lineRows(t, db, file.ID)

	skipped := map[string]string{}
	for _, line := range lines {
		if line.Outcome == "skipped" {
			skipped[line.PlatformType] = line.Reason
		}
	}

	if skipped["Withdrawal"] != "failed_withdrawal" || skipped["Earnings"] != "repeats_order_details" ||
		skipped["GMV Pay Deduction"] != "repeats_order_details" {
		t.Errorf("skipped = %v", skipped)
	}

	if file.Platform != "tiktok" || file.RowsPostedToShop != 1 || file.PeriodFrom == nil ||
		file.PeriodFrom.Format("2006-01-02") != "2026-09-01" {
		t.Errorf("file row = %+v", file)
	}
}

// Critique 8 — a TikTok file not in rupiah is refused as a whole.
func TestTiktokSettlementImport_RefusesAStatementNotInRupiah(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)

	end := last(w.importTiktok(t, tiktokShop, tiktokStatement(t, "MYR", false,
		[]tiktokOrder{{"5770001", "Order", "5770001", "2026/09/03", "97", "0", "0"}}, nil)))

	if !strings.Contains(end.text, "only rupiah (IDR) statements are imported") ||
		end.file.GetStatus() != settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_FAILED {
		t.Fatalf("the last message = %+v", end)
	}

	if len(w.ledger.posted()) != 0 {
		t.Fatal("a refused file posted")
	}
}

// A file with no Affiliate column is refused (my proposal, recorded with the decision): posted whole, its
// fund would carry the commission, and a later download with the column would take it a second time.
func TestTiktokSettlementImport_RefusesAStatementWithNoAffiliateColumn(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)

	end := last(w.importTiktok(t, tiktokShop, tiktokStatement(t, "IDR", true,
		[]tiktokOrder{{"5770001", "Order", "5770001", "2026/09/03", "97000", "", ""}}, nil)))

	if !strings.Contains(end.text, "no Affiliate commission column") ||
		end.file.GetStatus() != settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_FAILED {
		t.Fatalf("the last message = %+v", end)
	}
}

// The TikTok import takes only a TikTok shop — a Shopee shop's file down this RPC is refused, unstored.
func TestTiktokSettlementImport_RefusesAShopeeShop(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)

	messages := w.importTiktok(t, shopeeShop, aTiktokWeek(t))

	if len(messages) != 1 || !strings.Contains(messages[0].text, "Melati Official is not a TikTok shop") {
		t.Fatalf("messages = %+v", messages)
	}

	if len(w.store.stored) != 0 {
		t.Fatal("the refused file was stored")
	}
}
