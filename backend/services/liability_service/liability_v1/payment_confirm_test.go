package liability_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// recordPayment is phase one: the payer claims they paid.
func recordPayment(
	t *testing.T,
	svc *liability_v1.Service,
	payer, creditor uint64,
	amount int64,
) *liabilityv1.LiabilityPayment {
	t.Helper()

	res, err := svc.LiabilityPaymentRecord(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityPaymentRecordRequest{
			TeamId:         payer,
			CreditorTeamId: creditor,
			Amount:         amount,
			Note:           "BCA 1234",
		}))
	if err != nil {
		t.Fatalf("LiabilityPaymentRecord(%d -> %d): %v", payer, creditor, err)
	}

	return res.Msg.GetPayment()
}

func confirmPayment(
	t *testing.T,
	svc *liability_v1.Service,
	creditor, paymentID uint64,
) (*liabilityv1.LiabilityPayment, error) {
	t.Helper()

	res, err := svc.LiabilityPaymentConfirm(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityPaymentConfirmRequest{
			TeamId:    creditor,
			PaymentId: paymentID,
		}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetPayment(), nil
}

// owed reads what `team` owes `counterparty`, as a positive number.
func owed(t *testing.T, db *gorm.DB, team, counterparty uint64) int64 {
	t.Helper()

	return -balanceOf(t, db, team, counterparty)
}

// ⚠ RECORDING POSTS NOTHING. One side asserting a transfer is not evidence that it landed — a ledger
// that moved on a claim would let any team write off its own debt by typing a number.
func TestPaymentRecord_MovesNoMoney(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	recordPayment(t, svc, selling, warehouse, 15000)

	if got := owed(t, db, selling, warehouse); got != 15000 {
		t.Fatalf("debt = %d after merely RECORDING a payment, want 15000 — recording must not post",
			got)
	}
}

// THE CONFIRM IS WHAT POSTS, and it settles the debt in the right direction. Getting this backwards
// would be arithmetically consistent and completely wrong: paying would double the debt.
func TestPaymentConfirm_SettlesTheDebt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 15000)

	got, err := confirmPayment(t, svc, warehouse, payment.GetId())
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}

	if got.GetStatus() != liabilityv1.LiabilityPaymentStatus_LIABILITY_PAYMENT_STATUS_CONFIRMED {
		t.Fatalf("status = %v, want CONFIRMED", got.GetStatus())
	}

	if debt := owed(t, db, selling, warehouse); debt != 0 {
		t.Fatalf("debt = %d after paying it in full, want 0", debt)
	}

	// And the creditor's mirror leg moved too — both sides or neither.
	if got := balanceOf(t, db, warehouse, selling); got != 0 {
		t.Fatalf("the creditor still reads a receivable of %d, want 0", got)
	}
}

// A PARTIAL PAYMENT REDUCES THE DEBT AND LEAVES THE REST. The obvious case, and the one that would
// break if the posting used the payment's amount for one leg and the balance for the other.
func TestPaymentConfirm_PartialPaymentLeavesTheRemainder(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 5000)

	_, err := confirmPayment(t, svc, warehouse, payment.GetId())
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}

	if debt := owed(t, db, selling, warehouse); debt != 10000 {
		t.Fatalf("debt = %d after paying 5000 of 15000, want 10000", debt)
	}
}

// ⚠ ONLY THE CREDITOR MAY CONFIRM. The whole two-phase design rests on this: a payer able to confirm
// their own payment could write off any debt they liked by agreeing with themselves.
func TestPaymentConfirm_ThePayerCannotConfirmTheirOwnPayment(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 15000)

	_, err := confirmPayment(t, svc, selling, payment.GetId())
	if err == nil {
		t.Fatal("the payer confirmed their own payment — any debt can now be written off at will")
	}

	// NOT FOUND rather than PERMISSION_DENIED: a caller must not be able to probe payment ids to learn
	// who owes whom.
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}

	if debt := owed(t, db, selling, warehouse); debt != 15000 {
		t.Fatalf("debt = %d, want 15000 — the refused confirm still moved money", debt)
	}
}

// CONFIRMING TWICE SETTLES ONCE. Without the status guard the second confirm would post a second
// entry and pay the debt off twice — and two managers clicking Confirm in the same second is an
// ordinary event here, not a hypothetical.
func TestPaymentConfirm_CannotBeConfirmedTwice(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 15000)

	_, err := confirmPayment(t, svc, warehouse, payment.GetId())
	if err != nil {
		t.Fatalf("first confirm: %v", err)
	}

	_, err = confirmPayment(t, svc, warehouse, payment.GetId())
	if err == nil {
		t.Fatal("a payment was confirmed twice")
	}

	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	if debt := owed(t, db, selling, warehouse); debt != 0 {
		t.Fatalf("debt = %d, want 0 — a double confirm overpaid the debt", debt)
	}
}

// THE ENTRY SAYS WHAT CAUSED IT, BY ID. A settled debt must be traceable back to the payment that
// settled it, the same way a fee traces back to its order.
func TestPaymentConfirm_TheEntryNamesThePayment(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 15000)

	_, err := confirmPayment(t, svc, warehouse, payment.GetId())
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}

	var found bool

	for _, entry := range entryRows(history(t, svc, selling, warehouse)) {
		if entry.GetSourceType() != liabilityv1.LiabilitySourceType_LIABILITY_SOURCE_TYPE_PAYMENT {
			continue
		}

		found = true

		if entry.GetSourceId() != payment.GetId() {
			t.Fatalf("the payment entry names source %d, want payment %d",
				entry.GetSourceId(), payment.GetId())
		}
	}

	if !found {
		t.Fatal("no PAYMENT entry in the history — the liability is untraceable")
	}
}
