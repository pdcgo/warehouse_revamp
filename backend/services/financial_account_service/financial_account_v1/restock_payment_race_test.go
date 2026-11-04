//go:build raceaudit

// Concurrency audit for the restock-payment listener (the audit-sql skill). It keeps the ledger's one lock rule — every
// account FOR UPDATE, in id order, in one statement — and claims the event id beside the post. These tests hold it to
// that: a redelivery racing the first delivery posts once, a payment MOVED between two accounts never deadlocks against
// a hand transfer the other way, and a restock post waits on a post already holding its account.
//
//	go test -tags raceaudit -run 'TestRace_RestockPayment|TestInterleave_RestockPayment' -count=1 -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"fmt"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// The same create delivered four times at once — Pub/Sub redelivering while the first still runs: the restock is paid
// ONCE. A delivery that lost the claim may fail and be redelivered; it never posts a second time.
func TestRace_RestockPayment_OneEventFourDeliveries(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)
	x := mustCreate(t, svc, bca(teamA, "Ops BCA", "R000301", 500_000))

	res := h.Race(t, 4, func(int) error {
		return payRestock(svc, restockCreated("race-rc-same", x.GetId(), 120_000))
	})
	res.Report(t)

	if got := storedAccount(t, h.DB(), x.GetId()).Balance; got != 380_000 {
		t.Fatalf("balance = %v — the restock was paid more than once", got)
	}
}

// Restock payments MOVED from X to Y while a person transfers Y → X, at the same instant: never a deadlock — both lock
// the pair in id order — and the money is conserved.
func TestRace_RestockPayment_AMoveBesideAnOppositeTransferNeverDeadlocks(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)
	x := mustCreate(t, svc, bca(teamA, "Ops BCA", "R000311", 1_000_000))
	y := mustCreate(t, svc, cash(teamA, "Ops Cash", 1_000_000))

	res := h.Race(t, 8, func(i int) error {
		if i%2 == 0 {
			// Restock i was paid from X (not delivered here); the edit moves its 1.000 to Y.
			return payRestock(svc, restockUpdated(fmt.Sprintf("race-rm-%d", i), x.GetId(), y.GetId(), 1_000, 1_000))
		}

		return transfer(svc, teamA, y.GetId(), x.GetId(), 1_000, day(0))
	})
	res.Report(t)

	if n := res.Count(san_race.Deadlock); n != 0 {
		t.Fatalf("%d deadlocks — the move locks its two accounts in a different order than a transfer", n)
	}

	if res.Failed() != 0 {
		t.Fatalf("%d calls failed", res.Failed())
	}

	// Four moves give X its 1.000 back and take 1.000 from Y; four transfers move 1.000 Y → X. Nothing lost, nothing
	// made: X +8.000, Y −8.000.
	bx, by := storedAccount(t, h.DB(), x.GetId()).Balance, storedAccount(t, h.DB(), y.GetId()).Balance
	if bx != 1_008_000 || by != 992_000 {
		t.Fatalf("X = %v, Y = %v — want 1008000 and 992000", bx, by)
	}
}

// The PROOF: a restock payment out of an account a capital post already holds WAITS for it, then builds on its balance —
// the listener takes the same row lock every other write takes.
func TestInterleave_RestockPayment_WaitsForAPostOnItsAccount(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)
	x := mustCreate(t, svc, bca(teamA, "Ops BCA", "R000321", 500_000))

	sched := h.Interleave(t,
		san_race.Do("A", "A puts 1.000 of capital into the paying account", func(tx *gorm.DB) error {
			return capitalIn(on(tx), x.GetId(), 1_000)
		}),
		san_race.Block("B", "B posts a 120.000 restock out of the same account", func(tx *gorm.DB) error {
			return payRestock(on(tx), restockCreated("interleave-rc", x.GetId(), 120_000))
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	if !sched.Get("B posts a 120.000 restock out of the same account").Released {
		t.Fatal("B did not wait for A — the restock listener does not take the account lock")
	}

	if got := storedAccount(t, h.DB(), x.GetId()).Balance; got != 381_000 {
		t.Fatalf("balance = %v — want 381000, the restock built on the capital's balance", got)
	}
}
