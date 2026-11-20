package selling_v1_test

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// CETAK ULANG LABEL (a-changed-label-asks-the-warehouse-to-reprint, a-parcel-marked-for-reprint-is-not-handed-over,
// the-reprint-label-prototype-is-accepted): the print page's Print records when an order's label was printed, Edit Resi
// records when the resi or the label changed, and a change AFTER the print marks the order — on the warehouse list,
// the pick page's detail, the print page's read and Daftar Ambil's — until the label is printed again. A marked parcel
// is not handed over.

// otherWarehouse ships nothing of these orders.
const otherWarehouse uint64 = 901

// reprintService is a selling service whose label door holds team 2's three label files — signed alone, and readable
// for a merge of several.
func reprintService(t *testing.T, db *gorm.DB) *selling_v1.Service {
	t.Helper()

	label, _ := sampleLabel(t, "shopee_reg_01.pdf")
	file := selling_v1.LabelFile{Content: label, MimeType: "application/pdf"}

	return labelService(db, &fakeLinker{
		owners: map[string]uint64{"doc-old": 2, "doc-new": 2, "doc-newer": 2},
		files:  map[string]selling_v1.LabelFile{"doc-old": file, "doc-new": file, "doc-newer": file},
	})
}

// reprintOrder places team 2's order — tracking number JNE-OLD, label doc-old — and walks it to `to` as its warehouse.
func reprintOrder(t *testing.T, svc *selling_v1.Service, shopID uint64, to sellingv1.OrderStatus) uint64 {
	t.Helper()

	orderID := receiptOrder(t, svc, shopID)

	for _, step := range []sellingv1.OrderStatus{
		sellingv1.OrderStatus_ORDER_STATUS_PROCESSED,
		sellingv1.OrderStatus_ORDER_STATUS_PICKED,
	} {
		if to == sellingv1.OrderStatus_ORDER_STATUS_PENDING {
			break
		}

		moveOrder(t, svc, testWarehouse, orderID, step, "")

		if step == to {
			break
		}
	}

	return orderID
}

// printLabels is OrderLabels as the warehouse — `record` true is the print page's Print, false the order page's viewer.
func printLabels(t *testing.T, svc *selling_v1.Service, teamID uint64, record bool, orderIDs ...uint64) *sellingv1.OrderLabelsResponse {
	t.Helper()

	res, err := svc.OrderLabels(context.Background(), connect.NewRequest(&sellingv1.OrderLabelsRequest{
		TeamId:      teamID,
		OrderIds:    orderIDs,
		RecordPrint: record,
	}))
	if err != nil {
		t.Fatalf("OrderLabels(team %d, record %v, %v): %v", teamID, record, orderIDs, err)
	}

	return res.Msg
}

// changeResi is the seller's Edit Resi of the number alone.
func changeResi(t *testing.T, svc *selling_v1.Service, orderID uint64, code string) {
	t.Helper()

	_, err := editReceipt(svc, asUser(7), 2, orderID, str(code), nil)
	if err != nil {
		t.Fatalf("Edit Resi of %d: %v", orderID, err)
	}
}

// warehouseRows is the warehouse list's rows (every tab), optionally under Perlu cetak ulang.
func warehouseRows(t *testing.T, svc *selling_v1.Service, teamID uint64, onlyReprint bool) map[uint64]*sellingv1.Order {
	t.Helper()

	res, err := svc.OrderList(context.Background(), connect.NewRequest(&sellingv1.OrderListRequest{
		TeamId: teamID,
		Filter: &sellingv1.OrderListFilter{ReprintLabel: onlyReprint},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 100},
	}))
	if err != nil {
		t.Fatalf("OrderList(team %d, reprint %v): %v", teamID, onlyReprint, err)
	}

	out := map[uint64]*sellingv1.Order{}
	for _, order := range orderRows(res.Msg) {
		out[order.GetId()] = order
	}

	return out
}

// reprintMarked reads the mark on EVERY surface the warehouse reads it from — the list row, the filtered list, the
// detail the pick page reads, the print page's read and Daftar Ambil's — fails if any disagrees, and returns it.
func reprintMarked(t *testing.T, db *gorm.DB, svc *selling_v1.Service, orderID uint64) bool {
	t.Helper()

	row, ok := warehouseRows(t, svc, testWarehouse, false)[orderID]
	if !ok {
		t.Fatalf("order %d is not on its warehouse's list", orderID)
	}

	marked := row.GetReprintLabel()

	_, filtered := warehouseRows(t, svc, testWarehouse, true)[orderID]

	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: testWarehouse, OrderId: orderID,
	}))
	if err != nil {
		t.Fatalf("detail of %d: %v", orderID, err)
	}

	printed := orderPrintByIds(t, db, testWarehouse, orderID)
	picks := orderPickLines(t, db, testWarehouse, orderID)

	if filtered != marked || detail.Msg.GetOrder().GetReprintLabel() != marked || len(printed) != 1 ||
		printed[0].GetReprintLabel() != marked || len(picks) != 1 || picks[0].GetReprintLabel() != marked {
		t.Fatalf("order %d: list %v, Perlu cetak ulang %v, detail %v, print %v, pick %v — the surfaces disagree",
			orderID, marked, filtered, detail.Msg.GetOrder().GetReprintLabel(), printed, picks)
	}

	return marked
}

// A RESI OR LABEL CHANGE AFTER THE PRINT MARKS THE ORDER — on every surface, at each step Edit Resi is offered on —
// and the seller's own read says when the label was printed.
func TestReprintLabel_AChangeAfterThePrintMarksIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := reprintService(t, db)
	shop := insertShop(t, db, 2, "Toko Melati", "MEL-RP", "shopee")

	for _, step := range []sellingv1.OrderStatus{
		sellingv1.OrderStatus_ORDER_STATUS_PENDING,
		sellingv1.OrderStatus_ORDER_STATUS_PROCESSED,
		sellingv1.OrderStatus_ORDER_STATUS_PICKED,
	} {
		orderID := reprintOrder(t, svc, shop, step)

		printLabels(t, svc, testWarehouse, true, orderID)

		if reprintMarked(t, db, svc, orderID) {
			t.Fatalf("%v: marked right after its print", step)
		}

		changeResi(t, svc, orderID, "JNE-NEW")

		if !reprintMarked(t, db, svc, orderID) {
			t.Fatalf("%v: a change after the print left it unmarked", step)
		}

		seller, err := svc.OrderDetail(asUser(7), connect.NewRequest(&sellingv1.OrderDetailRequest{TeamId: 2, OrderId: orderID}))
		if err != nil {
			t.Fatalf("the seller's detail: %v", err)
		}

		if seller.Msg.GetOrder().GetLabelPrintedAtUnix() <= 0 {
			t.Fatalf("%v: the seller reads label_printed_at_unix %d, want the print's time", step,
				seller.Msg.GetOrder().GetLabelPrintedAtUnix())
		}
	}
}

// A CHANGE BEFORE ANY PRINT MARKS NOTHING — the first print takes the new label anyway — and an order never printed
// tells the seller 0.
func TestReprintLabel_AChangeBeforeAnyPrintMarksNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := reprintService(t, db)
	shop := insertShop(t, db, 2, "Toko Melati", "MEL-RP", "shopee")

	orderID := reprintOrder(t, svc, shop, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED)

	changeResi(t, svc, orderID, "JNE-NEW")

	if reprintMarked(t, db, svc, orderID) {
		t.Fatal("a change with no print marked the order")
	}

	if got := warehouseRows(t, svc, testWarehouse, false)[orderID].GetLabelPrintedAtUnix(); got != 0 {
		t.Fatalf("never printed, label_printed_at_unix = %d, want 0", got)
	}

	// Printed after the change: the PDF holds the new label.
	printLabels(t, svc, testWarehouse, true, orderID)

	if reprintMarked(t, db, svc, orderID) {
		t.Fatal("printed after the change, still marked")
	}
}

// THE PRINT PAGE'S PRINT CLEARS IT; THE ORDER PAGE'S VIEWER DOES NOT. OrderLabels without record_print looks and
// records nothing; with it, the included order is printed and its mark is gone.
func TestReprintLabel_ThePrintPagesPrintClearsItTheViewerDoesNot(t *testing.T) {
	db := san_testdb.DB(t)
	svc := reprintService(t, db)
	shop := insertShop(t, db, 2, "Toko Melati", "MEL-RP", "shopee")

	orderID := reprintOrder(t, svc, shop, sellingv1.OrderStatus_ORDER_STATUS_PICKED)

	printLabels(t, svc, testWarehouse, true, orderID)
	changeResi(t, svc, orderID, "JNE-NEW")

	viewed := printLabels(t, svc, testWarehouse, false, orderID)
	if !viewed.GetResults()[0].GetIncluded() {
		t.Fatalf("the viewer's link = %v", viewed.GetResults())
	}

	if !reprintMarked(t, db, svc, orderID) {
		t.Fatal("the order page's viewer cleared the mark")
	}

	printLabels(t, svc, testWarehouse, true, orderID)

	if reprintMarked(t, db, svc, orderID) {
		t.Fatal("the print page's Print left the mark")
	}

	// A reprint keeps the step and writes no timeline row.
	if got := orderStatus(t, svc, orderID); got != sellingv1.OrderStatus_ORDER_STATUS_PICKED {
		t.Fatalf("the reprint moved the order to %v", got)
	}

	_, rows := lastLog(t, svc, orderID)
	if rows != 4 {
		t.Fatalf("%d timeline rows, want 4 (placed, processed, picked, the edit) — a print writes none", rows)
	}
}

// A SECOND CHANGE AFTER THE REPRINT MARKS IT AGAIN.
func TestReprintLabel_ASecondChangeAfterTheReprintMarksAgain(t *testing.T) {
	db := san_testdb.DB(t)
	svc := reprintService(t, db)
	shop := insertShop(t, db, 2, "Toko Melati", "MEL-RP", "shopee")

	orderID := reprintOrder(t, svc, shop, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED)

	printLabels(t, svc, testWarehouse, true, orderID)
	changeResi(t, svc, orderID, "JNE-NEW")
	printLabels(t, svc, testWarehouse, true, orderID)

	if reprintMarked(t, db, svc, orderID) {
		t.Fatal("still marked after the reprint")
	}

	// The file this time.
	_, err := editReceipt(svc, asUser(7), 2, orderID, nil, &sellingv1.OrderReceipt{
		DocumentId: "doc-newer", Filename: "newer.pdf", MimeType: "application/pdf",
	})
	if err != nil {
		t.Fatalf("Edit Resi of the file: %v", err)
	}

	if !reprintMarked(t, db, svc, orderID) {
		t.Fatal("a second change after the reprint left it unmarked")
	}
}

// AN EDIT THAT CHANGES NOTHING MARKS NOTHING — a request naming only what is there writes nothing, the stamp included.
func TestReprintLabel_ANoOpEditMarksNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := reprintService(t, db)
	shop := insertShop(t, db, 2, "Toko Melati", "MEL-RP", "shopee")

	orderID := reprintOrder(t, svc, shop, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED)

	printLabels(t, svc, testWarehouse, true, orderID)
	changeResi(t, svc, orderID, "JNE-OLD")

	if reprintMarked(t, db, svc, orderID) {
		t.Fatal("an edit naming the same number marked the order")
	}
}

// AN ORDER LEFT OUT OF THE PDF KEEPS ITS MARK: the seller removed the file after the print, so the print page's Print
// finds no label for it — it is not printed, and stays marked until a new file is attached and printed. The order
// printed beside it in the same PDF is cleared.
func TestReprintLabel_AnOrderLeftOutOfThePDFKeepsItsMark(t *testing.T) {
	db := san_testdb.DB(t)
	svc := reprintService(t, db)
	shop := insertShop(t, db, 2, "Toko Melati", "MEL-RP", "shopee")

	leftOut := reprintOrder(t, svc, shop, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED)
	beside := reprintOrder(t, svc, shop, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED)

	printLabels(t, svc, testWarehouse, true, leftOut, beside)

	_, err := editReceipt(svc, asUser(7), 2, leftOut, nil, &sellingv1.OrderReceipt{})
	if err != nil {
		t.Fatalf("removing the file: %v", err)
	}

	changeResi(t, svc, beside, "JNE-NEW")

	res := printLabels(t, svc, testWarehouse, true, leftOut, beside)
	if res.GetResults()[0].GetReason() != sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NO_LABEL ||
		!res.GetResults()[1].GetIncluded() {
		t.Fatalf("results = %v, want the first NO_LABEL and the second included", res.GetResults())
	}

	if !reprintMarked(t, db, svc, leftOut) {
		t.Fatal("an order left out of the PDF lost its mark")
	}

	if reprintMarked(t, db, svc, beside) {
		t.Fatal("the order printed beside it is still marked")
	}
}

// FROM SHIPPING ON NOTHING IS MARKED — the courier has the parcel; neither the row nor Perlu cetak ulang reads it.
func TestReprintLabel_FromShippingOnNothingIsMarked(t *testing.T) {
	db := san_testdb.DB(t)
	svc := reprintService(t, db)
	shop := insertShop(t, db, 2, "Toko Melati", "MEL-RP", "shopee")

	for _, status := range []string{"shipping", "shipped", "completed", "problem", "return", "return_completed", "lost", "cancel"} {
		orderID := reprintOrder(t, svc, shop, sellingv1.OrderStatus_ORDER_STATUS_PICKED)

		printLabels(t, svc, testWarehouse, true, orderID)
		changeResi(t, svc, orderID, "JNE-NEW")

		if !reprintMarked(t, db, svc, orderID) {
			t.Fatal("setup: the order is not marked while picked")
		}

		setStatus(t, db, orderID, status)

		if reprintMarked(t, db, svc, orderID) {
			t.Fatalf("an order in %s reads marked", status)
		}
	}
}

// PERLU CETAK ULANG LISTS ONLY THE MARKED ORDERS, AND THE TAB COUNTS FOLLOW IT: OrderStat under the same filter counts
// only them, per status.
func TestReprintLabel_TheFilterListsOnlyTheMarkedAndTheTabsFollow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := reprintService(t, db)
	shop := insertShop(t, db, 2, "Toko Melati", "MEL-RP", "shopee")

	markedProcessed := reprintOrder(t, svc, shop, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED)
	markedPicked := reprintOrder(t, svc, shop, sellingv1.OrderStatus_ORDER_STATUS_PICKED)
	printedOnly := reprintOrder(t, svc, shop, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED)
	changedOnly := reprintOrder(t, svc, shop, sellingv1.OrderStatus_ORDER_STATUS_PICKED)
	untouched := reprintOrder(t, svc, shop, sellingv1.OrderStatus_ORDER_STATUS_PENDING)

	printLabels(t, svc, testWarehouse, true, markedProcessed)
	printLabels(t, svc, testWarehouse, true, markedPicked)
	printLabels(t, svc, testWarehouse, true, printedOnly)
	changeResi(t, svc, markedProcessed, "JNE-A")
	changeResi(t, svc, markedPicked, "JNE-B")
	changeResi(t, svc, changedOnly, "JNE-C")

	got := warehouseRows(t, svc, testWarehouse, true)

	ids := make([]uint64, 0, len(got))
	for id := range got {
		ids = append(ids, id)
	}

	slices.Sort(ids)

	want := []uint64{markedProcessed, markedPicked}
	slices.Sort(want)

	if !slices.Equal(ids, want) {
		t.Fatalf("Perlu cetak ulang lists %v, want only the marked %v (not %d, %d, %d)", ids, want, printedOnly, changedOnly,
			untouched)
	}

	stat, err := svc.OrderStat(context.Background(), connect.NewRequest(&sellingv1.OrderStatRequest{
		TeamId: testWarehouse,
		Filter: &sellingv1.OrderStatFilter{ReprintLabel: true},
	}))
	if err != nil {
		t.Fatalf("OrderStat: %v", err)
	}

	counts := map[sellingv1.OrderStatus]int64{}
	for _, row := range stat.Msg.GetByStatus() {
		counts[row.GetStatus()] = row.GetCount()
	}

	if counts[sellingv1.OrderStatus_ORDER_STATUS_PROCESSED] != 1 || counts[sellingv1.OrderStatus_ORDER_STATUS_PICKED] != 1 ||
		counts[sellingv1.OrderStatus_ORDER_STATUS_PENDING] != 0 || len(counts) != 2 {
		t.Fatalf("the tab counts under Perlu cetak ulang = %v, want processed 1 and picked 1 only", counts)
	}

	// The whole list, unfiltered, still reads all five.
	if n := len(warehouseRows(t, svc, testWarehouse, false)); n != 5 {
		t.Fatalf("the unfiltered list has %d orders, want 5", n)
	}
}

// THE FILTER AND THE ROW AGREE: the rule is written twice — needsReprint for a row in hand, reprintLabelCondition for
// the filter — and on every combination of the two stamps and every status, an order is on Perlu cetak ulang exactly
// when its row reads marked.
func TestReprintLabel_TheFilterAndTheRowAgree(t *testing.T) {
	db := san_testdb.DB(t)
	svc := reprintService(t, db)
	shop := insertShop(t, db, 2, "Toko Melati", "MEL-RP", "shopee")

	stamps := []struct {
		name             string
		printed, changed string // SQL for the stamp, "" = NULL
	}{
		{"never printed, never changed", "", ""},
		{"printed, never changed", "now() - interval '2 hours'", ""},
		{"changed, never printed", "", "now() - interval '1 hour'"},
		{"changed before the print", "now() - interval '1 hour'", "now() - interval '2 hours'"},
		{"changed after the print", "now() - interval '2 hours'", "now() - interval '1 hour'"},
		{"changed the same instant", "now() - interval '1 hour'", "now() - interval '1 hour'"},
	}
	statuses := []string{
		"pending", "processed", "picked", "shipping", "shipped", "completed", "problem", "return", "return_completed",
		"lost", "cancel",
	}

	type order struct {
		id    uint64
		label string
		want  bool
	}

	var orders []order

	for _, stamp := range stamps {
		for _, status := range statuses {
			orderID := receiptOrder(t, svc, shop)

			printed, changed := "NULL", "NULL"
			if stamp.printed != "" {
				printed = stamp.printed
			}

			if stamp.changed != "" {
				changed = stamp.changed
			}

			err := db.Exec("UPDATE orders SET status = ?, label_printed_at = "+printed+", receipt_changed_at = "+changed+
				" WHERE id = ?", status, orderID).Error
			if err != nil {
				t.Fatal(err)
			}

			want := stamp.name == "changed after the print" && (status == "pending" || status == "processed" || status == "picked")
			orders = append(orders, order{id: orderID, label: stamp.name + " / " + status, want: want})
		}
	}

	rows := warehouseRows(t, svc, testWarehouse, false)
	filtered := warehouseRows(t, svc, testWarehouse, true)

	for _, o := range orders {
		row, ok := rows[o.id]
		if !ok {
			t.Fatalf("%s: not on the list", o.label)
		}

		_, inFilter := filtered[o.id]

		if row.GetReprintLabel() != o.want || inFilter != o.want {
			t.Fatalf("%s: the row reads %v, Perlu cetak ulang %v — want both %v", o.label, row.GetReprintLabel(), inFilter, o.want)
		}
	}
}

// A MARKED PARCEL IS NOT HANDED OVER (a-parcel-marked-for-reprint-is-not-handed-over), from every door — the scan and
// the pick page's Tandai Diserahkan move one order, the bar's Serah Kurir many; all three are OrderStatusChange to
// shipping. Each order has its own result: the marked one is refused with its reason and stays picked, the unmarked one
// in the same batch moves. Reprinted, it goes.
func TestReprintLabel_TheHandoverRefusesAMarkedParcel(t *testing.T) {
	db := san_testdb.DB(t)
	svc := reprintService(t, db)
	shop := insertShop(t, db, 2, "Toko Melati", "MEL-RP", "shopee")

	marked := reprintOrder(t, svc, shop, sellingv1.OrderStatus_ORDER_STATUS_PICKED)
	unmarked := reprintOrder(t, svc, shop, sellingv1.OrderStatus_ORDER_STATUS_PICKED)

	printLabels(t, svc, testWarehouse, true, marked, unmarked)
	changeResi(t, svc, marked, "JNE-NEW")

	const reason = "the label changed after it was printed — print the new label first"

	// One order: the scan, the pick page.
	alone := changeStatus(t, svc, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING, "", marked)
	if alone[0].GetMoved() || alone[0].GetRefusedReason() != reason ||
		alone[0].GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_PICKED {
		t.Fatalf("the marked parcel alone = %+v, want refused %q, still picked", alone[0], reason)
	}

	// The bar's Serah Kurir: the batch moves what it can.
	batch := changeStatus(t, svc, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING, "", marked, unmarked)
	if batch[0].GetOrderId() != marked || batch[0].GetMoved() || batch[0].GetRefusedReason() != reason {
		t.Fatalf("the marked parcel in the batch = %+v, want refused %q", batch[0], reason)
	}

	if batch[1].GetOrderId() != unmarked || !batch[1].GetMoved() {
		t.Fatalf("the unmarked parcel in the batch = %+v, want moved", batch[1])
	}

	if got := orderStatus(t, svc, marked); got != sellingv1.OrderStatus_ORDER_STATUS_PICKED {
		t.Fatalf("the marked parcel is %v, want still picked", got)
	}

	// Reprinted, it is handed over.
	printLabels(t, svc, testWarehouse, true, marked)
	moveOrder(t, svc, testWarehouse, marked, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING, "")
}

// THE SCOPES: a warehouse marks, prints and hands over only the orders it ships. Another warehouse's Perlu cetak ulang
// lists none of them, its print is NOT_SHIPPED_HERE and records nothing, its handover reads "not one of this team's
// orders"; another selling team reads nothing marked.
func TestReprintLabel_OnlyTheShippingWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := reprintService(t, db)
	shop := insertShop(t, db, 2, "Toko Melati", "MEL-RP", "shopee")

	orderID := reprintOrder(t, svc, shop, sellingv1.OrderStatus_ORDER_STATUS_PICKED)

	printLabels(t, svc, testWarehouse, true, orderID)
	changeResi(t, svc, orderID, "JNE-NEW")

	if len(warehouseRows(t, svc, otherWarehouse, true)) != 0 || len(warehouseRows(t, svc, 3, true)) != 0 {
		t.Fatal("another team's Perlu cetak ulang lists this warehouse's order")
	}

	res := printLabels(t, svc, otherWarehouse, true, orderID)
	if res.GetResults()[0].GetReason() != sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NOT_SHIPPED_HERE {
		t.Fatalf("another warehouse's print = %v, want NOT_SHIPPED_HERE", res.GetResults())
	}

	if !reprintMarked(t, db, svc, orderID) {
		t.Fatal("another warehouse's print cleared the mark")
	}

	refused := changeStatus(t, svc, otherWarehouse, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING, "", orderID)
	if refused[0].GetMoved() || refused[0].GetRefusedReason() != "not one of this team's orders" {
		t.Fatalf("another warehouse's handover = %+v", refused[0])
	}

	// Its own warehouse marks it.
	if !warehouseRows(t, svc, testWarehouse, true)[orderID].GetReprintLabel() {
		t.Fatal("the shipping warehouse does not read its mark")
	}
}
