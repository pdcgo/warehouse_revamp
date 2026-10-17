package liability_v1_test

import (
	"context"
	"strconv"
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
	svc := liability_v1.NewService(db, nil, nil)

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
	svc := liability_v1.NewService(db, nil, nil)

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
	svc := liability_v1.NewService(db, nil, nil)

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
	svc := liability_v1.NewService(db, nil, nil)

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
	svc := liability_v1.NewService(db, nil, nil)

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
	svc := liability_v1.NewService(db, nil, nil)

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

func confirmInto(svc *liability_v1.Service, creditor, paymentID, toAccount uint64) (*liabilityv1.LiabilityPayment, error) {
	res, err := svc.LiabilityPaymentConfirm(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityPaymentConfirmRequest{
			TeamId:      creditor,
			PaymentId:   paymentID,
			ToAccountId: toAccount,
		}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetPayment(), nil
}

// a-team-payment-posts-on-accept: accepting names where the money LANDED, and tells the financial accounts both
// ends — the payer's account the payer named, and this one.
func TestPaymentConfirm_PublishesWhereTheMoneyLeftAndLanded(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &recordingSender{}
	svc := liability_v1.NewService(db, sent.send, bothBanks)

	oweThem(t, svc, db, 15000, 1)

	payment, err := recordFrom(svc, selling, warehouse, sellingBCA, 15000)
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	if len(sent.sent) != 0 {
		t.Fatalf("recording published %d events — a claim moves no account", len(sent.sent))
	}

	got, err := confirmInto(svc, warehouse, payment.GetId(), warehouseBCA)
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}

	if got.GetToAccountId() != warehouseBCA || got.GetFromAccountId() != sellingBCA {
		t.Fatalf("from/to = %d/%d, want %d/%d", got.GetFromAccountId(), got.GetToAccountId(), sellingBCA, warehouseBCA)
	}

	if len(sent.sent) != 1 {
		t.Fatalf("published %d events on accept, want 1", len(sent.sent))
	}

	event := sent.sent[0]
	accepted := event.GetLiabilityPaymentAccepted()

	if accepted == nil {
		t.Fatalf("published %T, want LiabilityPaymentAccepted", event.GetMessage())
	}

	if accepted.GetPaymentId() != payment.GetId() ||
		accepted.GetPayerTeamId() != selling || accepted.GetCreditorTeamId() != warehouse ||
		accepted.GetFromAccountId() != sellingBCA || accepted.GetToAccountId() != warehouseBCA ||
		accepted.GetAmount() != 15000 {
		t.Fatalf("event = %+v", accepted)
	}

	// Derived from the payment — a retried publish collides in the accounts' dedup instead of posting twice.
	if want := "liability-payment-accepted:" + strconv.FormatUint(payment.GetId(), 10); event.GetEventId() != want {
		t.Fatalf("event_id = %q, want %q", event.GetEventId(), want)
	}

	// The day both rows count on is the day the creditor accepted.
	if event.GetOccurredAt().AsTime().Unix() != got.GetConfirmedAtUnix() {
		t.Fatalf("occurred_at = %v, want the accept at %d", event.GetOccurredAt().AsTime(), got.GetConfirmedAtUnix())
	}
}

// ⚠ THE CREDITOR CANNOT LAND THE MONEY IN THE PAYER'S ACCOUNT. Refused before the payment is touched: it stays
// RECORDED, the debt stands, and nothing reaches the accounts.
func TestPaymentConfirm_RefusesAnAccountThatIsNotTheCreditors(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &recordingSender{}
	svc := liability_v1.NewService(db, sent.send, bothBanks)

	oweThem(t, svc, db, 15000, 1)

	payment, err := recordFrom(svc, selling, warehouse, sellingBCA, 15000)
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	_, err = confirmInto(svc, warehouse, payment.GetId(), sellingBCA)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}

	if debt := owed(t, db, selling, warehouse); debt != 15000 {
		t.Fatalf("debt = %d, want 15000 — a refused accept moved money", debt)
	}

	if len(sent.sent) != 0 {
		t.Fatalf("a refused accept published %d events", len(sent.sent))
	}

	// Still waiting, so the creditor can accept it into the right account.
	if _, err := confirmInto(svc, warehouse, payment.GetId(), warehouseBCA); err != nil {
		t.Fatalf("accept into the right account after a refusal: %v", err)
	}
}

// A REJECTED payment moves no account, so it tells the accounts nothing.
func TestPaymentConfirm_ARejectPublishesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &recordingSender{}
	svc := liability_v1.NewService(db, sent.send, bothBanks)

	oweThem(t, svc, db, 15000, 1)

	payment, err := recordFrom(svc, selling, warehouse, sellingBCA, 15000)
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	if _, err := rejectPayment(t, svc, warehouse, payment.GetId(), "no such transfer reached us"); err != nil {
		t.Fatalf("reject: %v", err)
	}

	if len(sent.sent) != 0 {
		t.Fatalf("a reject published %d events", len(sent.sent))
	}
}
