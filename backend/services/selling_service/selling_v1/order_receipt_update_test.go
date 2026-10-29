package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// EDIT RESI (the-seller-edits-the-resi-until-handover): the selling team changes the tracking number, the label file,
// or both, while the parcel is in the building — and each edit is a note naming the old and the new.

var oldLabel = &sellingv1.OrderReceipt{DocumentId: "doc-old", Filename: "old.pdf", MimeType: "application/pdf"}

// receiptOrder places team 2's order with a tracking number and a label file, by person 7.
func receiptOrder(t *testing.T, svc *selling_v1.Service, shopID uint64) uint64 {
	t.Helper()

	req := orderReq(shopID)
	req.ReceiptCode = "JNE-OLD"
	req.Receipt = oldLabel

	created, err := svc.OrderCreate(asUser(7), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	return created.Msg.GetOrder().GetId()
}

func editReceipt(
	svc *selling_v1.Service,
	ctx context.Context,
	teamID, orderID uint64,
	code *string,
	file *sellingv1.OrderReceipt,
) (*sellingv1.Order, error) {
	resp, err := svc.OrderReceiptUpdate(ctx, connect.NewRequest(&sellingv1.OrderReceiptUpdateRequest{
		TeamId: teamID, OrderId: orderID, ReceiptCode: code, Receipt: file,
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg.GetOrder(), nil
}

// lastLog is the newest row of the order's timeline, read by its selling team.
func lastLog(t *testing.T, svc *selling_v1.Service, orderID uint64) (*sellingv1.OrderTimelineLog, int) {
	t.Helper()

	rows := timeline(t, svc, asUser(7), 2, orderID)

	return rows[len(rows)-1], len(rows)
}

// The number alone: the file stays, and the note names the old number and the new one, from selling, by the person.
func TestOrderReceiptUpdate_TheNumberAloneKeepsTheFile(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	orderID := receiptOrder(t, svc, insertShop(t, db, 2, "Shop", "S1", "shopee"))

	got, err := editReceipt(svc, asUser(8), 2, orderID, str("JNE-NEW"), nil)
	if err != nil {
		t.Fatalf("OrderReceiptUpdate: %v", err)
	}

	if got.GetReceiptCode() != "JNE-NEW" || got.GetReceipt().GetDocumentId() != "doc-old" {
		t.Fatalf("the order = %q, file %q — want the new number and the old file", got.GetReceiptCode(),
			got.GetReceipt().GetDocumentId())
	}

	log, rows := lastLog(t, svc, orderID)
	if rows != 2 {
		t.Fatalf("%d timeline rows, want 2 (placed, the edit)", rows)
	}

	if log.GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED || log.GetNote() != "Resi: JNE-OLD → JNE-NEW" ||
		log.GetFrom() != sellingv1.OrderTimelineFrom_ORDER_TIMELINE_FROM_SELLING || log.GetActorId() != 8 {
		t.Fatalf("the edit's row = %+v, want no status, the old and the new, from SELLING by 8", log)
	}

	if orderStatus(t, svc, orderID) != sellingv1.OrderStatus_ORDER_STATUS_PENDING {
		t.Fatal("an edit moved the order")
	}
}

// The file alone: the number stays.
func TestOrderReceiptUpdate_TheFileAloneKeepsTheNumber(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	orderID := receiptOrder(t, svc, insertShop(t, db, 2, "Shop", "S1", "shopee"))

	newLabel := &sellingv1.OrderReceipt{DocumentId: "doc-new", Filename: "new.jpg", MimeType: "image/jpeg"}

	got, err := editReceipt(svc, asUser(7), 2, orderID, nil, newLabel)
	if err != nil {
		t.Fatalf("OrderReceiptUpdate: %v", err)
	}

	if got.GetReceiptCode() != "JNE-OLD" || got.GetReceipt().GetDocumentId() != "doc-new" ||
		got.GetReceipt().GetFilename() != "new.jpg" || got.GetReceipt().GetMimeType() != "image/jpeg" {
		t.Fatalf("the order = %q, %+v — want the old number and the new file", got.GetReceiptCode(), got.GetReceipt())
	}

	log, _ := lastLog(t, svc, orderID)
	if log.GetNote() != "Label: old.pdf → new.jpg" {
		t.Fatalf("the note = %q", log.GetNote())
	}
}

// Both at once are one note; adding a number to an order that had none reads as added; removing the file takes its
// labels with it.
func TestOrderReceiptUpdate_BothInOneNote(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")
	orderID := placeOrderAs(t, svc, asUser(7), 2, shopID)

	_, err := editReceipt(svc, asUser(7), 2, orderID, str("SPX-1"), oldLabel)
	if err != nil {
		t.Fatalf("OrderReceiptUpdate: %v", err)
	}

	log, _ := lastLog(t, svc, orderID)
	if log.GetNote() != "Resi: — → SPX-1 · Label: — → old.pdf" {
		t.Fatalf("the note = %q", log.GetNote())
	}

	got, err := editReceipt(svc, asUser(7), 2, orderID, nil, &sellingv1.OrderReceipt{Filename: "stale.pdf"})
	if err != nil {
		t.Fatalf("removing the file: %v", err)
	}

	if got.GetReceipt().GetDocumentId() != "" || got.GetReceipt().GetFilename() != "" || got.GetReceipt().GetMimeType() != "" {
		t.Fatalf("a removed file left %+v, want all three empty", got.GetReceipt())
	}

	log, _ = lastLog(t, svc, orderID)
	if log.GetNote() != "Label: old.pdf → —" {
		t.Fatalf("the removal's note = %q", log.GetNote())
	}
}

// Naming what is already there changes nothing and writes no note; naming nothing is refused.
func TestOrderReceiptUpdate_NothingNewWritesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	orderID := receiptOrder(t, svc, insertShop(t, db, 2, "Shop", "S1", "shopee"))

	_, err := editReceipt(svc, asUser(7), 2, orderID, str("JNE-OLD"), oldLabel)
	if err != nil {
		t.Fatalf("the same values: %v", err)
	}

	_, rows := lastLog(t, svc, orderID)
	if rows != 1 {
		t.Fatalf("%d timeline rows after an edit to the same values, want 1 (placed)", rows)
	}

	_, err = editReceipt(svc, asUser(7), 2, orderID, nil, nil)
	wantCode(t, err, connect.CodeInvalidArgument)
}

// Processed and picked still edit; from shipping on, and on a cancelled order, it is refused and nothing changes.
func TestOrderReceiptUpdate_OnlyUntilHandover(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")
	orderID := receiptOrder(t, svc, shopID)

	moveOrder(t, svc, testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "")

	_, err := editReceipt(svc, asUser(7), 2, orderID, str("JNE-PROCESSED"), nil)
	if err != nil {
		t.Fatalf("an edit while processed: %v", err)
	}

	moveOrder(t, svc, testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_PICKED, "")

	_, err = editReceipt(svc, asUser(7), 2, orderID, str("JNE-PICKED"), nil)
	if err != nil {
		t.Fatalf("an edit while picked: %v", err)
	}

	moveOrder(t, svc, testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING, "")

	_, err = editReceipt(svc, asUser(7), 2, orderID, str("JNE-SHIPPING"), nil)
	wantCode(t, err, connect.CodeFailedPrecondition)

	cancelled := receiptOrder(t, svc, shopID)
	cancel(t, svc, 2, cancelled)

	_, err = editReceipt(svc, asUser(7), 2, cancelled, str("JNE-CANCEL"), nil)
	wantCode(t, err, connect.CodeFailedPrecondition)

	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: orderID,
	}))
	if err != nil {
		t.Fatalf("OrderDetail: %v", err)
	}

	if detail.Msg.GetOrder().GetReceiptCode() != "JNE-PICKED" {
		t.Fatalf("after the refused edit the number is %q, want the picked one", detail.Msg.GetOrder().GetReceiptCode())
	}
}

// The order's warehouse and any other team read NotFound — the edit is the selling team's.
func TestOrderReceiptUpdate_OnlyTheSellingTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	orderID := receiptOrder(t, svc, insertShop(t, db, 2, "Shop", "S1", "shopee"))

	_, err := editReceipt(svc, asUser(9), testWarehouse, orderID, str("JNE-CREW"), nil)
	wantCode(t, err, connect.CodeNotFound)

	_, err = editReceipt(svc, asUser(9), 3, orderID, str("JNE-OTHER"), nil)
	wantCode(t, err, connect.CodeNotFound)

	_, rows := lastLog(t, svc, orderID)
	if rows != 1 {
		t.Fatalf("%d timeline rows after two refused edits, want 1", rows)
	}
}
