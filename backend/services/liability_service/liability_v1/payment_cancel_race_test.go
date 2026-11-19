//go:build raceaudit

// Concurrency audit for LiabilityPaymentCancel (the audit-sql skill) — a-pending-payment-is-cancelled-by-its-selling-team.
//
// WHY THIS RPC. It is the same check-then-act as confirm and reject: read the status, decide it is RECORDED, write a
// terminal one. The payer taking its claim back while the creditor accepts it is an ordinary second — and if both read
// RECORDED, the accept posts the money while the cancel marks the claim withdrawn: a settled debt whose claim says it
// was taken back, and an account movement for a payment the payer's screen calls cancelled.
//
//	go test -tags raceaudit -run 'TestRace_LiabilityPaymentCancel|TestInterleave_Cancel' -v ./backend/services/liability_service/liability_v1/
package liability_v1_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// cancelRaceSeed commits a 15000 debt and a 15000 pending payment against it, and returns the payment.
func cancelRaceSeed(t *testing.T, svc *liability_v1.Service, sourceID uint64) uint64 {
	t.Helper()

	ctx := context.Background()

	_, err := svc.PostEntry(ctx, nil, liability_v1.Posting{
		DebtorTeamID:   selling,
		CreditorTeamID: warehouse,
		Amount:         15000,
		SourceType:     liability_v1.SourceTypeIncidentalFee,
		SourceID:       sourceID,
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

	return recorded.Msg.GetPayment().GetId()
}

// settledOn reads the payment's status, its ledger rows and the pair's balance — the three must tell one story.
func settledOn(t *testing.T, db *gorm.DB, paymentID uint64) (string, int64, float64) {
	t.Helper()

	var status string

	err := db.Raw(`SELECT status FROM liability_payments WHERE id = ?`, paymentID).Scan(&status).Error
	if err != nil {
		t.Fatalf("read status: %v", err)
	}

	var entries int64

	err = db.Raw(`SELECT COUNT(*) FROM liability_logs WHERE source_type = 'payment' AND source_id = ?`, paymentID).
		Scan(&entries).
		Error
	if err != nil {
		t.Fatalf("count payment entries: %v", err)
	}

	var balance float64

	err = db.Raw(`SELECT balance FROM liability_balances WHERE team_id = ? AND counterparty_id = ?`, selling, warehouse).
		Scan(&balance).
		Error
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}

	return status, entries, balance
}

// The callers whose act goes second in a round sleep a few ms first, so each pairing is run BOTH ways round — a race
// the same side always wins would never exercise the other side's losing path.
var cancelRaceOrders = []struct {
	name        string
	cancelFirst bool
}{
	{"the creditor first", false},
	{"the payer first", true},
}

// raceDelay holds back the side that goes second in this round.
func raceDelay(isCancel, cancelFirst bool) {
	if isCancel != cancelFirst {
		time.Sleep(3 * time.Millisecond)
	}
}

// ⛔ CANCEL AGAINST CONFIRM, on one claim, in the same second. Exactly one act wins, and the status, the ledger and the
// balance agree: accepted → posted ONCE and squared; cancelled → nothing posted and the debt untouched.
func TestRace_LiabilityPaymentCancelAgainstConfirm(t *testing.T) {
	for _, order := range cancelRaceOrders {
		t.Run(order.name, func(t *testing.T) {
			h := san_race.New(t, paymentTables...)
			db := h.DB()
			svc := liability_v1.NewService(db, nil, nil, cancelTeams())
			ctx := context.Background()

			paymentID := cancelRaceSeed(t, svc, 9101)

			res := h.Race(t, 8, func(i int) error {
				isCancel := i%2 == 1
				raceDelay(isCancel, order.cancelFirst)

				if !isCancel {
					_, confirmErr := svc.LiabilityPaymentConfirm(ctx,
						connect.NewRequest(&liabilityv1.LiabilityPaymentConfirmRequest{
							TeamId:    warehouse,
							PaymentId: paymentID,
						}))

					return confirmErr
				}

				_, cancelErr := svc.LiabilityPaymentCancel(ctx,
					connect.NewRequest(&liabilityv1.LiabilityPaymentCancelRequest{
						TeamId:    selling,
						PaymentId: paymentID,
					}))

				return cancelErr
			})

			res.Report(t)

			if won := 8 - res.Failed(); won != 1 {
				t.Fatalf("%d of 8 acts succeeded, want exactly 1 — one claim was both accepted and taken back", won)
			}

			status, entries, balance := settledOn(t, db, paymentID)

			switch status {
			case "confirmed":
				// One posting is TWO rows — the creditor's leg and the debtor's mirror (PostEntry). More is a second post.
				if entries != 2 || balance != 0 {
					t.Fatalf("status=confirmed but %d entries and balance=%v, want the 2 legs of one posting and 0",
						entries, balance)
				}
			case "cancelled":
				if entries != 0 || balance != -15000 {
					t.Fatalf("status=cancelled but %d entries and balance=%v, want 0 entries and -15000 — a "+
						"cancelled claim settled a debt", entries, balance)
				}
			default:
				t.Fatalf("status = %q, want confirmed or cancelled", status)
			}

			t.Logf("cancel vs confirm, %s: %s won", order.name, status)
		})
	}
}

// ⛔ CANCEL AGAINST REJECT. Both post nothing, so the money cannot go wrong — but the claim must end on ONE terminal
// status, and the loser must be told, not quietly overwrite the winner (a rejection reason under a cancelled claim).
func TestRace_LiabilityPaymentCancelAgainstReject(t *testing.T) {
	for _, order := range cancelRaceOrders {
		t.Run(order.name, func(t *testing.T) {
			h := san_race.New(t, paymentTables...)
			db := h.DB()
			svc := liability_v1.NewService(db, nil, nil, cancelTeams())
			ctx := context.Background()

			paymentID := cancelRaceSeed(t, svc, 9102)

			res := h.Race(t, 8, func(i int) error {
				isCancel := i%2 == 1
				raceDelay(isCancel, order.cancelFirst)

				if !isCancel {
					_, rejectErr := svc.LiabilityPaymentReject(ctx,
						connect.NewRequest(&liabilityv1.LiabilityPaymentRejectRequest{
							TeamId:    warehouse,
							PaymentId: paymentID,
							Reason:    "not in our account",
						}))

					return rejectErr
				}

				_, cancelErr := svc.LiabilityPaymentCancel(ctx,
					connect.NewRequest(&liabilityv1.LiabilityPaymentCancelRequest{
						TeamId:    selling,
						PaymentId: paymentID,
					}))

				return cancelErr
			})

			res.Report(t)

			if won := 8 - res.Failed(); won != 1 {
				t.Fatalf("%d of 8 acts succeeded, want exactly 1", won)
			}

			status, entries, balance := settledOn(t, db, paymentID)

			if status != "rejected" && status != "cancelled" {
				t.Fatalf("status = %q, want rejected or cancelled", status)
			}

			if entries != 0 || balance != -15000 {
				t.Fatalf("status=%s with %d entries and balance=%v, want nothing posted and -15000",
					status, entries, balance)
			}

			var reason string

			err := db.Raw(`SELECT reason FROM liability_payments WHERE id = ?`, paymentID).Scan(&reason).Error
			if err != nil {
				t.Fatalf("read reason: %v", err)
			}

			// The reason is the reject's; a cancelled claim carries none — a mixed row is two acts landing on one claim.
			if (status == "cancelled") != (reason == "") {
				t.Fatalf("status=%s with reason %q — the claim carries the loser's half", status, reason)
			}

			t.Logf("cancel vs reject, %s: %s won", order.name, status)
		})
	}
}

// AND THE DETERMINISTIC HALF the races above can only make likely: the creditor holds the payment's row lock (its
// accept, mid-transaction), the payer's cancel is started — it must WAIT on that lock, then RE-READ the status once the
// accept commits and refuse with FailedPrecondition. A cancel that read before the lock (no FOR UPDATE) would act on
// the RECORDED it saw and overwrite the accept: the claim would read cancelled over a posted payment.
func TestInterleave_CancelWaitsForAnAcceptAndRefuses(t *testing.T) {
	h := san_race.New(t, paymentTables...)
	db := h.DB()
	svc := liability_v1.NewService(db, nil, nil, cancelTeams())

	paymentID := cancelRaceSeed(t, svc, 9103)

	accept := db.Begin()

	var held string

	err := accept.Raw(`SELECT status FROM liability_payments WHERE id = ? FOR UPDATE`, paymentID).Scan(&held).Error
	if err != nil {
		accept.Rollback()
		t.Fatalf("hold the row: %v", err)
	}

	done := make(chan error, 1)

	go func() {
		_, cancelErr := svc.LiabilityPaymentCancel(context.Background(),
			connect.NewRequest(&liabilityv1.LiabilityPaymentCancelRequest{
				TeamId:    selling,
				PaymentId: paymentID,
			}))
		done <- cancelErr
	}()

	// The cancel must be PARKED on the payment's row — never finished while the accept holds it.
	waiting := false

	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline) && !waiting; {
		select {
		case early := <-done:
			accept.Rollback()
			t.Fatalf("the cancel returned (%v) while the accept held the payment's row — it never waited", early)
		default:
		}

		waiters, waitErr := san_race.Waiters(db)
		if waitErr != nil {
			accept.Rollback()
			t.Fatalf("read waiters: %v", waitErr)
		}

		for _, w := range waiters {
			if strings.Contains(w.Waiting, "liability_payments") {
				waiting = true
			}
		}

		time.Sleep(20 * time.Millisecond)
	}

	if !waiting {
		accept.Rollback()
		t.Fatal("the cancel never waited on the payment's row lock")
	}

	err = accept.Exec(`UPDATE liability_payments SET status = 'confirmed' WHERE id = ?`, paymentID).Error
	if err != nil {
		accept.Rollback()
		t.Fatalf("accept: %v", err)
	}

	err = accept.Commit().Error
	if err != nil {
		t.Fatalf("commit the accept: %v", err)
	}

	cancelErr := <-done
	if connect.CodeOf(cancelErr) != connect.CodeFailedPrecondition {
		t.Fatalf("the cancel after the accept committed answered %v, want FailedPrecondition — it acted on what it "+
			"read before it waited", cancelErr)
	}

	var status string

	err = db.Raw(`SELECT status FROM liability_payments WHERE id = ?`, paymentID).Scan(&status).Error
	if err != nil {
		t.Fatalf("read status: %v", err)
	}

	if status != "confirmed" {
		t.Fatalf("status = %q, want \"confirmed\" — the cancel overwrote an accepted payment", status)
	}
}
