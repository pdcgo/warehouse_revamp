package settlement_importer_v1_test

import (
	"strings"
	"testing"

	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_importer_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_v1"
)

// two-live-orders-on-a-ref-post-to-the-shop, Shopee: a ref on two live orders of the shop posts to the SHOP — no
// order, no creator, so settlement counts it for the primary CS — with reason several_orders, both ids recorded, a
// WARN naming them, and the line counted among those posted to the shop.
func TestShopeeSettlementImport_TwoLiveOrdersOnARefPostToTheShop(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)
	w.orders.byRef["2509AAA"] = []settlement_importer_v1.OrderRef{
		{OrderID: 9002, ShopID: shopeeShop, CreatedByUserID: orderMaker},
		{OrderID: 9001, ShopID: shopeeShop, CreatedByUserID: orderMaker + 1},
	}

	messages := w.importShopee(t, shopeeShop, sevenShopeeRows(t))

	if done := last(messages); done.text != "Done — 3 posted, 0 already there, 2 held, 2 skipped" {
		t.Fatalf("the import ended %q", done.text)
	}

	row1 := rowMessage(t, messages, 1)
	if row1.level != settlement_importerv1.LogLevel_LOG_LEVEL_WARN ||
		row1.text != "Row 1: 2509AAA is on 2 live orders (#9001, #9002) — posted to the shop" {
		t.Fatalf("row 1 = %+v", row1)
	}

	post := w.ledger.posted()[0]
	if post.OrderID != 0 || post.CreatedByUserID != 0 || post.Change != 185_000 {
		t.Fatalf("the line must post to the shop, counted for nobody it names: %+v", post)
	}

	file := fileRows(t, db)[0]
	if file.RowsPostedToShop != 2 {
		t.Fatalf("posted to the shop = %d, want 2 — the unmatched ref and the doubled one", file.RowsPostedToShop)
	}

	line := lineRows(t, db, file.ID)[0]
	if line.Outcome != "posted" || line.Reason != "several_orders" || line.OrderID != 0 ||
		line.FoundOrderIDs != "9001,9002" || line.SettlementLogID == 0 {
		t.Fatalf("the line = %+v", line)
	}

	// The file page's to-the-shop view finds it by its reason, ids and all.
	resp, err := listLines(t, w, file.ID,
		[]settlement_importerv1.UploadedFileLineOutcome{settlement_importerv1.UploadedFileLineOutcome_UPLOADED_FILE_LINE_OUTCOME_POSTED},
		[]settlement_importerv1.UploadedFileLineReason{settlement_importerv1.UploadedFileLineReason_UPLOADED_FILE_LINE_REASON_SEVERAL_ORDERS},
	)
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	lines := linesOf(resp)
	if len(lines) != 1 || lines[0].GetOrderRef() != "2509AAA" || lines[0].GetOrderId() != 0 ||
		len(lines[0].GetFoundOrderIds()) != 2 || lines[0].GetFoundOrderIds()[0] != 9001 || lines[0].GetFoundOrderIds()[1] != 9002 {
		t.Fatalf("the several-orders view = %+v", lines)
	}
}

// A live order and a cancelled one on the same ref is NOT several: the cancel-and-re-create double keeps posting to
// its one live order, with no reason and no ids.
func TestShopeeSettlementImport_ALiveAndACancelledOrderPostToTheLiveOne(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)
	w.orders.byRef["2509AAA"] = []settlement_importer_v1.OrderRef{
		{OrderID: 9002, ShopID: shopeeShop, CreatedByUserID: orderMaker + 1, Cancelled: true},
		{OrderID: 9001, ShopID: shopeeShop, CreatedByUserID: orderMaker},
	}

	w.importShopee(t, shopeeShop, sevenShopeeRows(t))

	post := w.ledger.posted()[0]
	if post.OrderID != 9001 || post.CreatedByUserID != orderMaker {
		t.Fatalf("the line must post to the live order: %+v", post)
	}

	file := fileRows(t, db)[0]
	line := lineRows(t, db, file.ID)[0]

	if line.Reason != "" || line.OrderID != 9001 || line.FoundOrderIDs != "" || file.RowsPostedToShop != 1 {
		t.Fatalf("the line = %+v, file = %+v", line, file)
	}
}

// two-live-orders-on-a-ref-post-to-the-shop, TikTok: every row of the doubled Related order ID — the order row, its
// commission and the reimbursement that names it — posts to the shop with both ids.
func TestTiktokSettlementImport_TwoLiveOrdersOnARefPostToTheShop(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)
	w.orders.byRef["5770001"] = []settlement_importer_v1.OrderRef{
		{OrderID: 801, ShopID: tiktokShop, CreatedByUserID: orderMaker},
		{OrderID: 802, ShopID: tiktokShop, CreatedByUserID: orderMaker},
	}

	end := last(w.importTiktok(t, tiktokShop, aTiktokWeek(t)))
	if end.text != "Done — 6 posted, 0 already there, 1 held, 3 skipped" {
		t.Fatalf("the import ended %q", end.text)
	}

	for _, post := range w.ledger.posted() {
		if post.OrderID != 0 {
			t.Errorf("no row may post to an order: %+v", post)
		}
	}

	file := fileRows(t, db)[0]

	several := 0

	for _, line := range lineRows(t, db, file.ID) {
		if line.OrderRef != "5770001" {
			continue
		}

		if line.Reason != "several_orders" || line.FoundOrderIDs != "801,802" || line.OrderID != 0 {
			t.Errorf("line %d = %+v", line.LineNo, line)
		}

		several++
	}

	// The fund, its affiliate commission and the logistics reimbursement.
	if several != 3 {
		t.Fatalf("%d lines on 5770001, want 3", several)
	}

	// Those three and 5770002, which has no order — the platform reimbursement names no order ref at all.
	if file.RowsPostedToShop != 4 {
		t.Fatalf("posted to the shop = %d, want 4", file.RowsPostedToShop)
	}
}

// rowMessage is the stream's "Row n:" message.
func rowMessage(t *testing.T, messages []message, step uint32) message {
	t.Helper()

	for _, m := range messages {
		if m.step == step && strings.HasPrefix(m.text, "Row ") {
			return m
		}
	}

	t.Fatalf("no message for row %d", step)

	return message{}
}
