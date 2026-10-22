//go:build raceaudit

// Concurrency audit for the team-payment listener (the audit-sql skill) — the one write that locks accounts of
// TWO TEAMS at once. It keeps the ledger's lock rule (every account FOR UPDATE, in id order, one statement), and
// these tests hold it to that: payments both ways between the same two accounts never deadlock, a redelivery
// racing the first delivery posts once, and a payment waits on a post already holding the creditor's account.
//
//	go test -tags raceaudit -run 'TestRace_TeamPayment|TestInterleave_TeamPayment' -count=1 -v ./backend/services/financial_account_service/financial_account_v1/
package financial_account_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// payTeam delivers one acceptance — payer's `from` out, creditor's `to` in.
func payTeam(svc *financial_account_v1.Service, eventID string, payer, creditor, from, to uint64, amount int64) error {
	return svc.TeamPaymentHandler()(context.Background(), &eventsv1.Event{
		EventId:     eventID,
		OccurredAt:  timestamppb.Now(),
		AggregateId: "liability-payment:" + eventID,
		Message: &eventsv1.Event_LiabilityPaymentAccepted{LiabilityPaymentAccepted: &eventsv1.LiabilityPaymentAccepted{
			PayerTeamId:    payer,
			CreditorTeamId: creditor,
			Amount:         amount,
			FromAccountId:  from,
			ToAccountId:    to,
			ActorId:        ani,
		}},
	})
}

// Payments both ways between one seller account and one warehouse account at the same instant: never a deadlock —
// the two teams' accounts are locked in id order like a transfer's — and the money is conserved.
func TestRace_TeamPayment_OppositeDirectionsNeverDeadlock(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)
	x := mustCreate(t, svc, bca(teamA, "Seller BCA", "R000201", 1_000_000))
	y := mustCreate(t, svc, bca(teamB, "Gudang BCA", "R000202", 1_000_000))

	res := h.Race(t, 8, func(i int) error {
		id := fmt.Sprintf("race-tp-%d", i)
		if i%2 == 0 {
			return payTeam(svc, id, teamA, teamB, x.GetId(), y.GetId(), 1_000)
		}

		return payTeam(svc, id, teamB, teamA, y.GetId(), x.GetId(), 1_000)
	})
	res.Report(t)

	if n := res.Count(san_race.Deadlock); n != 0 {
		t.Fatalf("%d deadlocks — the two teams' accounts are locked in different orders", n)
	}

	if res.Failed() != 0 {
		t.Fatalf("%d payments failed", res.Failed())
	}

	bx, by := storedAccount(t, h.DB(), x.GetId()).Balance, storedAccount(t, h.DB(), y.GetId()).Balance
	if bx != 1_000_000 || by != 1_000_000 {
		t.Fatalf("X = %v, Y = %v — four each way should leave both where they started", bx, by)
	}
}

// The same acceptance delivered four times at once — Pub/Sub redelivering while the first still runs: the transfer
// posts ONCE. A delivery that lost the claim may fail and be redelivered; it never posts a second time.
func TestRace_TeamPayment_OneEventFourDeliveries(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)
	x := mustCreate(t, svc, bca(teamA, "Seller BCA", "R000211", 500_000))
	y := mustCreate(t, svc, bca(teamB, "Gudang BCA", "R000212", 0))

	res := h.Race(t, 4, func(int) error {
		return payTeam(svc, "race-tp-same", teamA, teamB, x.GetId(), y.GetId(), 200_000)
	})
	res.Report(t)

	if got := storedAccount(t, h.DB(), y.GetId()).Balance; got != 200_000 {
		t.Fatalf("creditor = %v — the payment posted more than once", got)
	}

	if got := storedAccount(t, h.DB(), x.GetId()).Balance; got != 300_000 {
		t.Fatalf("payer = %v — the payment left more than once", got)
	}
}

// The PROOF: an acceptance landing in an account a capital post already holds WAITS for it, then builds on its
// balance — lockOwnedAccounts takes the same row lock every other write takes.
func TestInterleave_TeamPayment_WaitsForAPostOnTheCreditorsAccount(t *testing.T) {
	h := raceHarness(t)
	svc := financial_account_v1.NewService(h.DB(), testShops)
	x := mustCreate(t, svc, bca(teamA, "Seller BCA", "R000221", 500_000))
	y := mustCreate(t, svc, bca(teamB, "Gudang BCA", "R000222", 0))

	capitalIntoY := func(tx *gorm.DB) error {
		_, err := on(tx).FinancialAccountCapital(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountCapitalRequest{
			TeamId: teamB, AccountId: y.GetId(), Direction: financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_IN, Amount: 1_000, OccurredOn: day(0),
		}))

		return err
	}

	sched := h.Interleave(t,
		san_race.Do("A", "A puts 1.000 of capital into the creditor's account", capitalIntoY),
		san_race.Block("B", "B lands a 200.000 payment in the same account", func(tx *gorm.DB) error {
			return payTeam(on(tx), "interleave-tp", teamA, teamB, x.GetId(), y.GetId(), 200_000)
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	if !sched.Get("B lands a 200.000 payment in the same account").Released {
		t.Fatal("B did not wait for A — the team payment does not take the account lock")
	}

	rows := logs(t, h.DB(), y.GetId())
	if last := rows[len(rows)-1]; last.BalanceAfter != 201_000 {
		t.Fatalf("B's balance_after = %v, want 201.000 — it did not read A's balance", last.BalanceAfter)
	}
}
