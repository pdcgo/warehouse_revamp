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
