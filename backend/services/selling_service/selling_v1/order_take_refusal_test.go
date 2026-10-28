package selling_v1_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// takeRefused is the take's refusal exactly as inventory_service builds it (a-refusal-names-its-reason-and-every-line):
// a Connect error with one reason, carrying an OrderTransactionRefusal detail that names every refused line.
func takeRefused(
	t *testing.T,
	reason inventoryv1.OrderTransactionRefusalReason,
	lines ...*inventoryv1.OrderTransactionRefusedLine,
) error {
	t.Helper()

	err := connect.NewError(connect.CodeFailedPrecondition, errors.New("order transaction refused: "+reason.String()))

	detail, detailErr := connect.NewErrorDetail(&inventoryv1.OrderTransactionRefusal{Reason: reason, Lines: lines})
	if detailErr != nil {
		t.Fatalf("build the refusal detail: %v", detailErr)
	}

	err.AddDetail(detail)

	return err
}

// refusalIn is the OrderTransactionRefusal riding on err — what the order form decodes to say WHY.
func refusalIn(t *testing.T, err error) *inventoryv1.OrderTransactionRefusal {
	t.Helper()

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		t.Fatalf("err %v is not a Connect error", err)
	}

	for _, detail := range connectErr.Details() {
		value, valueErr := detail.Value()
		if valueErr != nil {
			continue
		}

		if refusal, ok := value.(*inventoryv1.OrderTransactionRefusal); ok {
			return refusal
		}
	}

	t.Fatalf("err %v carries no OrderTransactionRefusal", err)

	return nil
}

// A TAKE REFUSED FOR SHORT STOCK REACHES THE CALLER AS IT CAME — its code and its detail, not Internal. The person at
// the form can fix this order by lowering one quantity, and can only learn which from the lines the refusal names.
func TestOrderCreate_AShortTakeReachesTheCallerWithItsCodeAndDetail(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{pickErr: takeRefused(t,
		inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_NOT_ENOUGH_STOCK,
		&inventoryv1.OrderTransactionRefusedLine{ProductId: 100, Wanted: 3, Available: 1},
	)}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want the take's FailedPrecondition — not Internal", connect.CodeOf(err))
	}

	refusal := refusalIn(t, err)
	if refusal.GetReason() != inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_NOT_ENOUGH_STOCK {
		t.Fatalf("reason = %v, want NOT_ENOUGH_STOCK", refusal.GetReason())
	}

	lines := refusal.GetLines()
	if len(lines) != 1 || lines[0].GetProductId() != 100 || lines[0].GetWanted() != 3 || lines[0].GetAvailable() != 1 {
		t.Fatalf("refused lines %v — want product 100, wanted 3, available 1", lines)
	}

	// Still no order, and the take is still released by its key — the refusal changes what is SAID, not what is done.
	assertNoOrders(t, db)

	if len(picker.returned) != 1 {
		t.Fatalf("the refused take was released %d times, want 1", len(picker.returned))
	}
}

// THE SECOND DOOR says it the same way: a promote whose take refuses a borrowed product (below its owner's reserve)
// answers with the take's code and detail, and the draft survives to be fixed.
func TestOrderDraftPromote_ARefusedTakeReachesTheCallerWithItsCodeAndDetail(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{pickErr: takeRefused(t,
		inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_NOT_ALLOWED,
		&inventoryv1.OrderTransactionRefusedLine{ProductId: 41, Wanted: 2},
	)}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	draftID := readyDraft(t, svc, db, shop)

	_, err := promote(t, svc, 7, 2, draftID)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want the take's FailedPrecondition — not Internal", connect.CodeOf(err))
	}

	refusal := refusalIn(t, err)
	if refusal.GetReason() != inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_NOT_ALLOWED ||
		len(refusal.GetLines()) != 1 || refusal.GetLines()[0].GetProductId() != 41 {
		t.Fatalf("refusal %v — want NOT_ALLOWED naming product 41", refusal)
	}

	var drafts int64

	err = db.Model(&selling_service_models.OrderDraft{}).Where("id = ?", draftID).Count(&drafts).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if drafts != 1 {
		t.Fatal("a refused promote destroyed the draft")
	}
}

// A take that never answered in its own terms — not a Connect error at all — is this service's Internal, as before.
// Only the warehouse's own answer is passed through.
func TestOrderCreate_ATakeThatNeverAnsweredIsInternal(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{pickErr: errors.New("connection reset by peer")}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("code = %v, want Internal", connect.CodeOf(err))
	}

	assertNoOrders(t, db)
}
