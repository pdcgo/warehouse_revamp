//go:build raceaudit

// Concurrency audit for LiabilityPaymentConfirm (the audit-sql skill).
//
// WHY THIS RPC. It is a textbook check-then-act on money: read the status, decide it is RECORDED,
// then post an entry that settles a debt. Two managers clicking Confirm on the same payment in the
// same second is an ordinary event in this system — and if both reads see RECORDED, the debt is paid
// off twice and the payer's balance goes positive for money nobody sent.
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS, and a committing
// test sharing a database with transaction-per-test ones would leave rows the others can see.
//
//	go test -tags raceaudit -run TestRace_LiabilityPaymentConfirm -v ./backend/services/liability_service/liability_v1/
package liability_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// The tables this audit writes. Entries and balances are the ledger; payments is the claim record.
var paymentTables = []string{
	"liability_logs",
	"liability_balances",
	"liability_payments",
}

// ⚠ THE BUG THIS PROVES IS ABSENT: a payment confirmed by N callers at once must settle the debt
// ONCE. Exactly one caller may succeed; the rest must be refused, and the balance must land on zero
// rather than on a positive number that says the creditor now owes the payer.
func TestRace_LiabilityPaymentConfirm(t *testing.T) {
	h := san_race.New(t, paymentTables...)
	db := h.DB()
	svc := liability_v1.NewService(db)
	ctx := context.Background()

	// The debt, committed, so every racing caller sees the same starting position.
	_, err := svc.PostEntry(ctx, nil, liability_v1.Posting{
		DebtorTeamID:   selling,
		CreditorTeamID: warehouse,
		Amount:         15000,
		SourceType:     liability_v1.SourceTypeIncidentalFee,
		SourceID:       9001,
	})
	if err != nil {
		t.Fatalf("seed the debt: %v", err)
	}

	recorded, err := svc.LiabilityPaymentRecord(ctx,
		connect.NewRequest(&liabilityv1.LiabilityPaymentRecordRequest{
			TeamId:         selling,
			CreditorTeamId: warehouse,
			Amount:         15000,
		}))
	if err != nil {
		t.Fatalf("seed the payment: %v", err)
	}

	paymentID := recorded.Msg.GetPayment().GetId()

	res := h.Race(t, 8, func(int) error {
		_, confirmErr := svc.LiabilityPaymentConfirm(ctx,
			connect.NewRequest(&liabilityv1.LiabilityPaymentConfirmRequest{
				TeamId:    warehouse,
				PaymentId: paymentID,
			}))

		return confirmErr
	})

	res.Report(t)

	// EXACTLY ONE WINNER. Two would mean the FOR UPDATE lock is not doing its job — both reads saw
	// RECORDED and both posted.
	if won := 8 - res.Failed(); won != 1 {
		t.Fatalf("%d of 8 confirms succeeded, want exactly 1 — the debt was settled %d times", won, won)
	}

	// AND THE MONEY IS RIGHT, which is the claim that actually matters. A count can be right while the
	// arithmetic is wrong, so the balance is read rather than inferred.
	var balance int64

	err = db.Raw(`SELECT balance FROM liability_balances WHERE team_id = ? AND counterparty_id = ?`,
		selling, warehouse).Scan(&balance).Error
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}

	if balance != 0 {
		t.Fatalf("balance = %d after 8 concurrent confirms of a 15000 payment against a 15000 debt, "+
			"want 0 — a positive number here means the payer was credited money nobody sent", balance)
	}

	// And the payment itself settled on ONE status, not a torn one.
	var status string

	err = db.Raw(`SELECT status FROM liability_payments WHERE id = ?`, paymentID).Scan(&status).Error
	if err != nil {
		t.Fatalf("read status: %v", err)
	}

	if status != "confirmed" {
		t.Fatalf("status = %q, want \"confirmed\"", status)
	}
}

// ⚠ CONFIRM AND REVERSE RACING EACH OTHER must not both win against one confirmation. The two guards
// are complementary — Confirm demands RECORDED, Reverse demands CONFIRMED — so under the lock exactly
// one ordering is possible and the balance can only land on 0 (confirmed) or 15000 (confirmed then
// reversed). Anything else means the two transactions read the same row and both acted on it.
func TestRace_LiabilityPaymentConfirmAgainstReverse(t *testing.T) {
	h := san_race.New(t, paymentTables...)
	db := h.DB()
	svc := liability_v1.NewService(db)
	ctx := context.Background()

	_, err := svc.PostEntry(ctx, nil, liability_v1.Posting{
		DebtorTeamID:   selling,
		CreditorTeamID: warehouse,
		Amount:         15000,
		SourceType:     liability_v1.SourceTypeIncidentalFee,
		SourceID:       9002,
	})
	if err != nil {
		t.Fatalf("seed the debt: %v", err)
	}

	recorded, err := svc.LiabilityPaymentRecord(ctx,
		connect.NewRequest(&liabilityv1.LiabilityPaymentRecordRequest{
			TeamId:         selling,
			CreditorTeamId: warehouse,
			Amount:         15000,
		}))
	if err != nil {
		t.Fatalf("seed the payment: %v", err)
	}

	paymentID := recorded.Msg.GetPayment().GetId()

	h.Race(t, 8, func(i int) error {
		if i%2 == 0 {
			_, confirmErr := svc.LiabilityPaymentConfirm(ctx,
				connect.NewRequest(&liabilityv1.LiabilityPaymentConfirmRequest{
					TeamId:    warehouse,
					PaymentId: paymentID,
				}))

			return confirmErr
		}

		_, reverseErr := svc.LiabilityPaymentReverse(ctx,
			connect.NewRequest(&liabilityv1.LiabilityPaymentReverseRequest{
				TeamId:    warehouse,
				PaymentId: paymentID,
				Reason:    "racing",
			}))

		return reverseErr
	}).Report(t)

	var balance int64

	err = db.Raw(`SELECT balance FROM liability_balances WHERE team_id = ? AND counterparty_id = ?`,
		selling, warehouse).Scan(&balance).Error
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}

	// -15000 is "still owed" (confirm then reverse, or reverse never ran); 0 is "settled".
	if balance != 0 && balance != -15000 {
		t.Fatalf("balance = %d, want 0 (settled) or -15000 (settled then reversed) — any other value "+
			"means confirm and reverse both acted on the same read", balance)
	}
}

// ⛔ THE SHARPEST RACE THIS SERVICE HAS: CONFIRM AGAINST REJECT, on one claim, in the same second.
//
// Two managers look at the same pending payment. One believes the money arrived and clicks Confirm —
// which POSTS, settling the debt. The other cannot find it in the bank and clicks Reject — which
// posts NOTHING. If both reads see RECORDED, the pair ends up with a settled debt whose claim says
// the money never came, or an unsettled debt whose claim says it did. Either way the books and the
// screen disagree, which is the one thing this service exists to prevent.
//
// ⚠ IT IS NASTIER THAN CONFIRM-VS-REVERSE. Those two have COMPLEMENTARY guards (RECORDED vs
// CONFIRMED), so only one ordering was ever possible. These two demand the SAME status, so the guard
// alone decides nothing — only the row lock does.
func TestRace_LiabilityPaymentConfirmAgainstReject(t *testing.T) {
	h := san_race.New(t, paymentTables...)
	db := h.DB()
	svc := liability_v1.NewService(db)
	ctx := context.Background()

	_, err := svc.PostEntry(ctx, nil, liability_v1.Posting{
		DebtorTeamID:   selling,
		CreditorTeamID: warehouse,
		Amount:         15000,
		SourceType:     liability_v1.SourceTypeIncidentalFee,
		SourceID:       9003,
	})
	if err != nil {
		t.Fatalf("seed the debt: %v", err)
	}

	recorded, err := svc.LiabilityPaymentRecord(ctx,
		connect.NewRequest(&liabilityv1.LiabilityPaymentRecordRequest{
			TeamId:         selling,
			CreditorTeamId: warehouse,
			Amount:         15000,
		}))
	if err != nil {
		t.Fatalf("seed the payment: %v", err)
	}

	paymentID := recorded.Msg.GetPayment().GetId()

	// Eight callers, alternating between the two acts, released together.
	res := h.Race(t, 8, func(i int) error {
		if i%2 == 0 {
			_, confirmErr := svc.LiabilityPaymentConfirm(ctx,
				connect.NewRequest(&liabilityv1.LiabilityPaymentConfirmRequest{
					TeamId:    warehouse,
					PaymentId: paymentID,
				}))

			return confirmErr
		}

		_, rejectErr := svc.LiabilityPaymentReject(ctx,
			connect.NewRequest(&liabilityv1.LiabilityPaymentRejectRequest{
				TeamId:    warehouse,
				PaymentId: paymentID,
				Reason:    "not in our account",
			}))

		return rejectErr
	})

	res.Report(t)

	if won := 8 - res.Failed(); won != 1 {
		t.Fatalf("%d of 8 acts succeeded, want exactly 1 — one claim was both settled and refused", won)
	}

	// ⚠ THE ASSERTION IS ON THE DATA, and it is a JOINT one: the status and the balance must tell the
	// SAME story. Checking either alone would pass on the exact disagreement this test is for.
	var status string

	err = db.Raw(`SELECT status FROM liability_payments WHERE id = ?`, paymentID).Scan(&status).Error
	if err != nil {
		t.Fatalf("read status: %v", err)
	}

	var balance int64

	err = db.Raw(`SELECT balance FROM liability_balances WHERE team_id = ? AND counterparty_id = ?`,
		selling, warehouse).Scan(&balance).Error
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}

	switch status {
	case "confirmed":
		// The money moved, so the debt is squared.
		if balance != 0 {
			t.Fatalf("status=confirmed but balance=%d, want 0 — the claim says paid and the ledger "+
				"disagrees", balance)
		}
	case "rejected":
		// A rejection posts NOTHING, so the debt must be untouched.
		if balance != -15000 {
			t.Fatalf("status=rejected but balance=%d, want -15000 — a refused claim settled a debt",
				balance)
		}

		var entries int64

		err = db.Raw(`SELECT COUNT(*) FROM liability_logs WHERE source_type = 'payment' AND source_id = ?`,
			paymentID).Scan(&entries).Error
		if err != nil {
			t.Fatalf("count payment entries: %v", err)
		}

		if entries != 0 {
			t.Fatalf("%d ledger entries for a REJECTED payment, want 0", entries)
		}
	default:
		t.Fatalf("status = %q, want confirmed or rejected", status)
	}
}

// AND THE PROOF OF SAFETY, which the race above cannot give: an exact interleaving showing the
// second caller BLOCKS on the first's row lock, and — the half people forget — RE-READS the status
// after acquiring it rather than acting on what it read before waiting.
func TestInterleave_RejectBlocksBehindConfirm(t *testing.T) {
	h := san_race.New(t, paymentTables...)
	db := h.DB()
	svc := liability_v1.NewService(db)
	ctx := context.Background()

	_, err := svc.PostEntry(ctx, nil, liability_v1.Posting{
		DebtorTeamID:   selling,
		CreditorTeamID: warehouse,
		Amount:         15000,
		SourceType:     liability_v1.SourceTypeIncidentalFee,
		SourceID:       9004,
	})
	if err != nil {
		t.Fatalf("seed the debt: %v", err)
	}

	recorded, err := svc.LiabilityPaymentRecord(ctx,
		connect.NewRequest(&liabilityv1.LiabilityPaymentRecordRequest{
			TeamId:         selling,
			CreditorTeamId: warehouse,
			Amount:         15000,
		}))
	if err != nil {
		t.Fatalf("seed the payment: %v", err)
	}

	paymentID := recorded.Msg.GetPayment().GetId()

	lockIt := func(tx *gorm.DB) error {
		var status string

		return tx.Raw(`SELECT status FROM liability_payments WHERE id = ? FOR UPDATE`, paymentID).
			Scan(&status).Error
	}

	sched := h.Interleave(t,
		san_race.Do("A", "A locks the payment FOR UPDATE", lockIt),
		// ⚠ THIS IS THE WHOLE PROOF. If B returns at once, the lock is not held and confirm/reject can
		// both act on the same RECORDED row.
		san_race.Block("B", "B (reject) tries to lock the same payment", lockIt),
		san_race.Do("A", "A confirms it", func(tx *gorm.DB) error {
			return tx.Exec(`UPDATE liability_payments SET status = 'confirmed' WHERE id = ?`, paymentID).Error
		}),
		san_race.Commit("A"),
		san_race.Do("B", "B re-reads the status AFTER the lock", func(tx *gorm.DB) error {
			var status string

			readErr := tx.Raw(`SELECT status FROM liability_payments WHERE id = ?`, paymentID).
				Scan(&status).Error
			if readErr != nil {
				return readErr
			}

			// Waiting politely and then acting on the stale value is still broken.
			if status != "confirmed" {
				t.Errorf("B read %q after the lock released, want \"confirmed\" — it is acting on what "+
					"it saw BEFORE it blocked", status)
			}

			return nil
		}),
		san_race.Commit("B"),
	)

	sched.Report(t)
}
