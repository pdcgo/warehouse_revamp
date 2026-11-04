//go:build raceaudit

// Concurrency audit for the transfer-shipping listener (the audit-sql skill). It posts through the restock listener's
// postPaymentLegs — every account FOR UPDATE, in id order, in one statement — and claims the event id beside the post.
// These tests hold it to that: a redelivery racing the first delivery posts once, shipping MOVED between two accounts
// and its edits never deadlock against hand transfers on the same accounts, and a shipping post waits on a post already
// holding its account.
//
//	go test -tags raceaudit -run 'TestRace_TransferShipping|TestInterleave_TransferShipping' -count=1 -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"fmt"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// The same create delivered four times at once — Pub/Sub redelivering while the first still runs: the trip is paid
// ONCE. A delivery that lost the claim may fail and be redelivered; it never posts a second time.
func TestRace_TransferShipping_OneEventFourDeliveries(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)
	x := mustCreate(t, svc, bca(teamA, "Ops BCA", "R000401", 500_000))

	res := h.Race(t, 4, func(int) error {
		return payShipping(svc, transferCreated("race-ts-same", x.GetId(), 18_000))
	})
	res.Report(t)

	if got := storedAccount(t, h.DB(), x.GetId()).Balance; got != 482_000 {
		t.Fatalf("balance = %v — the trip was paid more than once", got)
	}
}

// Shipping costs, their edits and their moves X → Y, beside hand transfers both ways between the same two accounts, all
// at the same instant: never a deadlock — every write locks the pair in id order — and the money is exactly the sum.
func TestRace_TransferShipping_BesideHandTransfersOnTheSameAccounts(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)
	x := mustCreate(t, svc, bca(teamA, "Ops BCA", "R000411", 1_000_000))
	y := mustCreate(t, svc, cash(teamA, "Ops Cash", 1_000_000))

	res := h.Race(t, 12, func(i int) error {
		switch i % 6 {
		case 0:
			// A trip of 10.000 out of X.
			return payShipping(svc, transferCreated(fmt.Sprintf("race-tc-%d", i), x.GetId(), 10_000))
		case 1:
			// An edit on X, 10.000 → 12.000.
			return payShipping(svc, transferUpdated(fmt.Sprintf("race-tu-%d", i), x.GetId(), x.GetId(), 10_000, 12_000))
		case 2:
			// A trip paid from X (not delivered here) moved to Y: X +3.000, Y −3.000.
			return payShipping(svc, transferUpdated(fmt.Sprintf("race-tm-%d", i), x.GetId(), y.GetId(), 3_000, 3_000))
		case 3:
			// A cancel refunding 4.000 into Y.
			return payShipping(svc, transferCancelled(fmt.Sprintf("race-tx-%d", i), y.GetId(), 4_000))
		case 4:
			return transfer(svc, teamA, y.GetId(), x.GetId(), 1_000, day(0))
		default:
			return transfer(svc, teamA, x.GetId(), y.GetId(), 1_000, day(0))
		}
	})
	res.Report(t)

	if n := res.Count(san_race.Deadlock); n != 0 {
		t.Fatalf("%d deadlocks — the listener locks its accounts in a different order than a transfer", n)
	}

	if res.Failed() != 0 {
		t.Fatalf("%d calls failed", res.Failed())
	}

	// Two of each: X −20.000 (trips) −4.000 (edits) +6.000 (moves) +2.000 −2.000 (transfers) = −18.000;
	// Y −6.000 (moves) +8.000 (refunds) −2.000 +2.000 (transfers) = +2.000.
	bx, by := storedAccount(t, h.DB(), x.GetId()).Balance, storedAccount(t, h.DB(), y.GetId()).Balance
	if bx != 982_000 || by != 1_002_000 {
		t.Fatalf("X = %v, Y = %v — want 982000 and 1002000", bx, by)
	}
}

// The PROOF: a shipping post out of an account a capital post already holds WAITS for it, then builds on its balance —
// the listener takes the same row lock every other write takes.
func TestInterleave_TransferShipping_WaitsForAPostOnItsAccount(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)
	x := mustCreate(t, svc, bca(teamA, "Ops BCA", "R000421", 500_000))

	sched := h.Interleave(t,
		san_race.Do("A", "A puts 1.000 of capital into the paying account", func(tx *gorm.DB) error {
			return capitalIn(on(tx), x.GetId(), 1_000)
		}),
		san_race.Block("B", "B posts an 18.000 transfer shipping out of the same account", func(tx *gorm.DB) error {
			return payShipping(on(tx), transferCreated("interleave-ts", x.GetId(), 18_000))
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	if !sched.Get("B posts an 18.000 transfer shipping out of the same account").Released {
		t.Fatal("B did not wait for A — the transfer-shipping listener does not take the account lock")
	}

	if got := storedAccount(t, h.DB(), x.GetId()).Balance; got != 483_000 {
		t.Fatalf("balance = %v — want 483000, the shipping built on the capital's balance", got)
	}
}
