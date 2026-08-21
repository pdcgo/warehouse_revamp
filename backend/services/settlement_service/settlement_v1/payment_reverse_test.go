package settlement_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

func reversePayment(
	t *testing.T,
	svc *settlement_v1.Service,
	creditor, paymentID uint64,
) (*settlementv1.SettlementPayment, error) {
	t.Helper()

	res, err := svc.SettlementPaymentReverse(context.Background(),
		connect.NewRequest(&settlementv1.SettlementPaymentReverseRequest{
			TeamId:    creditor,
			PaymentId: paymentID,
			Reason:    "the transfer bounced",
		}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetPayment(), nil
}

// REVERSING PUTS THE DEBT BACK. The balance nets to where it was before the confirmation.
func TestPaymentReverse_RestoresTheDebt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 15000)

	_, err := confirmPayment(t, svc, warehouse, payment.GetId())
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}

	got, err := reversePayment(t, svc, warehouse, payment.GetId())
	if err != nil {
		t.Fatalf("reverse: %v", err)
	}

	if got.GetStatus() != settlementv1.SettlementPaymentStatus_SETTLEMENT_PAYMENT_STATUS_REVERSED {
		t.Fatalf("status = %v, want REVERSED", got.GetStatus())
	}

	if debt := owed(t, db, selling, warehouse); debt != 15000 {
		t.Fatalf("debt = %d after reversing the payment, want 15000", debt)
	}
}

// ⚠ IT IS A COMPENSATING ENTRY, NOT A DELETE. The confirmation stays in the history and the undo
// joins it — "it was briefly settled" is exactly what an audit needs to see, and a ledger you can
// edit is not evidence of anything.
func TestPaymentReverse_LeavesBothEntriesInTheHistory(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 15000)

	_, err := confirmPayment(t, svc, warehouse, payment.GetId())
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}

	_, err = reversePayment(t, svc, warehouse, payment.GetId())
	if err != nil {
		t.Fatalf("reverse: %v", err)
	}

	var posted, reversed int

	for _, entry := range entryRows(history(t, svc, selling, warehouse)) {
		if entry.GetSourceType() != settlementv1.SettlementSourceType_SETTLEMENT_SOURCE_TYPE_PAYMENT {
			continue
		}

		if entry.GetReversal() {
			reversed++
		} else {
			posted++
		}
	}

	if posted != 1 || reversed != 1 {
		t.Fatalf("%d payment entries and %d reversals, want 1 and 1 — the confirmation was edited "+
			"rather than compensated", posted, reversed)
	}
}

// ONLY A CONFIRMED PAYMENT CAN BE REVERSED. Reversing a RECORDED one would post an undo for a
// movement that never happened, taking the balance somewhere it has never been.
func TestPaymentReverse_RefusesAPaymentThatWasNeverConfirmed(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 15000)

	_, err := reversePayment(t, svc, warehouse, payment.GetId())
	if err == nil {
		t.Fatal("an unconfirmed payment was reversed")
	}

	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	if debt := owed(t, db, selling, warehouse); debt != 15000 {
		t.Fatalf("debt = %d, want 15000 — reversing nothing moved money", debt)
	}
}

// REVERSING TWICE UNDOES ONCE. Without the status guard the debt would be charged a second time.
func TestPaymentReverse_CannotBeReversedTwice(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 15000)

	_, err := confirmPayment(t, svc, warehouse, payment.GetId())
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}

	_, err = reversePayment(t, svc, warehouse, payment.GetId())
	if err != nil {
		t.Fatalf("first reverse: %v", err)
	}

	_, err = reversePayment(t, svc, warehouse, payment.GetId())
	if err == nil {
		t.Fatal("a payment was reversed twice")
	}

	if debt := owed(t, db, selling, warehouse); debt != 15000 {
		t.Fatalf("debt = %d, want 15000 — a double reversal charged the debt twice", debt)
	}
}

// A REVERSED PAYMENT CANNOT BE RE-CONFIRMED. Re-confirming would settle a debt the creditor has
// already said was not settled — the correction has to stick.
func TestPaymentReverse_ReversedCannotBeConfirmedAgain(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 15000)

	_, err := confirmPayment(t, svc, warehouse, payment.GetId())
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}

	_, err = reversePayment(t, svc, warehouse, payment.GetId())
	if err != nil {
		t.Fatalf("reverse: %v", err)
	}

	_, err = confirmPayment(t, svc, warehouse, payment.GetId())
	if err == nil {
		t.Fatal("a reversed payment was confirmed again — the correction did not stick")
	}

	if debt := owed(t, db, selling, warehouse); debt != 15000 {
		t.Fatalf("debt = %d, want 15000", debt)
	}
}

// ONLY THE CREDITOR MAY REVERSE — whoever confirmed is who un-confirms.
func TestPaymentReverse_ThePayerCannotReverse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 15000)

	_, err := confirmPayment(t, svc, warehouse, payment.GetId())
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}

	_, err = reversePayment(t, svc, selling, payment.GetId())
	if err == nil {
		t.Fatal("the payer reversed a confirmation it did not make")
	}

	if debt := owed(t, db, selling, warehouse); debt != 0 {
		t.Fatalf("debt = %d, want 0 — the refused reversal still moved money", debt)
	}
}
