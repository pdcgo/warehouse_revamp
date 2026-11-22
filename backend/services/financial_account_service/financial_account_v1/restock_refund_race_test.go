//go:build raceaudit

// Concurrency audit for a restock REFUND resolution's post (backlog #101): the restock listener's fourth event, through
// postPaymentLegs — the account FOR UPDATE, the claim beside the post.
//
//	go test -tags raceaudit -run 'TestRace_RestockRefund' -count=1 -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"fmt"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// The same refund delivered four times at once — Pub/Sub redelivering while the first still runs: the money comes back
// ONCE. Beside it, four other refunds and two hand transfers on the same account: never a deadlock, the sum exact.
func TestRace_RestockRefund_OneEventFourDeliveriesBesideOthers(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops, nil, nil)
	x := mustCreate(t, svc, bca(teamA, "Ops BCA", "R000601", 500_000))
	y := mustCreate(t, svc, cash(teamA, "Ops Cash", 500_000))

	res := h.Race(t, 10, func(i int) error {
		switch {
		case i < 4:
			return payRestock(svc, restockRefunded("race-refund-same", x.GetId(), 40_000))
		case i < 8:
			return payRestock(svc, restockRefunded(fmt.Sprintf("race-refund-%d", i), x.GetId(), 1_000))
		case i == 8:
			return transfer(svc, teamA, x.GetId(), y.GetId(), 1_000, day(0))
		default:
			return transfer(svc, teamA, y.GetId(), x.GetId(), 1_000, day(0))
		}
	})
	res.Report(t)

	if n := res.Count(san_race.Deadlock); n != 0 {
		t.Fatalf("%d deadlocks", n)
	}

	if res.Failed() != 0 {
		t.Fatalf("%d calls failed", res.Failed())
	}

	// +40.000 once, +4 × 1.000, the transfers net 0.
	if got := storedAccount(t, h.DB(), x.GetId()).Balance; got != 544_000 {
		t.Fatalf("balance = %v, want 544000 — the refund came back once", got)
	}
}
