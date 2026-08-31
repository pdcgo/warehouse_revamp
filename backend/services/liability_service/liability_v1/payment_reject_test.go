package liability_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

func rejectPayment(
	t *testing.T,
	svc *liability_v1.Service,
	creditor, paymentID uint64,
	reason string,
) (*liabilityv1.LiabilityPayment, error) {
	t.Helper()

	res, err := svc.LiabilityPaymentReject(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityPaymentRejectRequest{
			TeamId:    creditor,
			PaymentId: paymentID,
			Reason:    reason,
		}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetPayment(), nil
}

// REJECTING POSTS NOTHING. This is the whole reason the state exists: before it, a creditor facing a
// claim that never landed had to CONFIRM and then REVERSE, writing two real ledger movements for
// money that never moved.
func TestPaymentReject_MovesNoMoney(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 15000)

	before := owed(t, db, selling, warehouse)

	got, err := rejectPayment(t, svc, warehouse, payment.GetId(), "no such transfer in our account")
	if err != nil {
		t.Fatalf("reject: %v", err)
	}

	if got.GetStatus() != liabilityv1.LiabilityPaymentStatus_LIABILITY_PAYMENT_STATUS_REJECTED {
		t.Fatalf("status = %v, want REJECTED", got.GetStatus())
	}

	if after := owed(t, db, selling, warehouse); after != before {
		t.Fatalf("debt = %d after rejecting, want %d unchanged — a rejection must post nothing",
			after, before)
	}

	// ⚠ AND NO LEDGER ROW AT ALL, not merely a net of zero. A pair of cancelling entries would leave
	// the pair's history claiming money moved twice, which is the story a rejection exists to avoid.
	var entries int64

	err = db.Model(&liability_service_models.LiabilityLog{}).
		Where("source_type = ? AND source_id = ?", "payment", payment.GetId()).
		Count(&entries).Error
	if err != nil {
		t.Fatalf("count payment entries: %v", err)
	}

	if entries != 0 {
		t.Fatalf("%d ledger entries for a rejected payment, want 0", entries)
	}
}

// THE REASON REACHES THE PAYER. A refusal a debtor cannot read is a debt they cannot fix — they would
// see a claim marked wrong with no way to know whether to re-send the slip or the money.
func TestPaymentReject_KeepsTheReason(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 15000)

	const why = "the slip is for last month"

	got, err := rejectPayment(t, svc, warehouse, payment.GetId(), why)
	if err != nil {
		t.Fatalf("reject: %v", err)
	}

	if got.GetReason() != why {
		t.Fatalf("reason = %q, want %q", got.GetReason(), why)
	}

	// ⚠ AND `confirmed_by` / `confirmed_at` STAY EMPTY. Borrowing those columns to record who refused
	// would make every "when was this agreed" query count refusals as agreements.
	if got.GetConfirmedBy() != 0 || got.GetConfirmedAtUnix() != 0 {
		t.Fatalf("confirmed_by = %d, confirmed_at = %d — a rejection is not a confirmation",
			got.GetConfirmedBy(), got.GetConfirmedAtUnix())
	}
}

// ONLY THE CREDITOR MAY REJECT, and somebody else's payment is NOT FOUND rather than forbidden — a
// caller must not be able to probe ids to learn who owes whom.
func TestPaymentReject_ThePayerCannotRejectTheirOwnClaim(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 15000)

	_, err := rejectPayment(t, svc, selling, payment.GetId(), "changed my mind")
	if err == nil {
		t.Fatal("the payer rejected their own claim, want NotFound")
	}

	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}

// A CONFIRMED PAYMENT CANNOT BE REJECTED. Rejecting one would leave a posted entry beside a claim
// saying the money never came — the disagreement between books and screen this service exists to
// prevent. That correction is LiabilityPaymentReverse, which posts the compensating entry a rejection
// deliberately does not.
func TestPaymentReject_RefusesAConfirmedPayment(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 15000)

	_, err := confirmPayment(t, svc, warehouse, payment.GetId())
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}

	_, err = rejectPayment(t, svc, warehouse, payment.GetId(), "actually it never arrived")
	if err == nil {
		t.Fatal("rejected a confirmed payment, want FailedPrecondition")
	}

	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}

// REJECTION IS TERMINAL. The owner's lifecycle diagram ends there, so a second act on the same claim
// must fail rather than quietly overwrite the first refusal.
func TestPaymentReject_IsTerminal(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	oweThem(t, svc, db, 15000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 15000)

	_, err := rejectPayment(t, svc, warehouse, payment.GetId(), "no such transfer")
	if err != nil {
		t.Fatalf("reject: %v", err)
	}

	// Neither a second rejection …
	_, err = rejectPayment(t, svc, warehouse, payment.GetId(), "still no")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("second reject: code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	// … nor a confirmation that would settle a debt the creditor has already refused.
	_, err = confirmPayment(t, svc, warehouse, payment.GetId())
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("confirm after reject: code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	if debt := owed(t, db, selling, warehouse); debt != 15000 {
		t.Fatalf("debt = %d, want 15000 — a rejected claim must never settle anything", debt)
	}
}
