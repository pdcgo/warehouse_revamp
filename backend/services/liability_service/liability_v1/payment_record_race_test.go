//go:build raceaudit

// Concurrency audit for LiabilityPaymentRecord (the audit-sql skill).
//
// WHY THIS RPC. Since the-debtor-claims-the-creditor-decides was enforced it is a check-then-act: read the payer's side
// of the pair, decide it owes, then insert the claim. The race worth proving is a CONFIRM squaring the pair in the same
// second as a second claim — read before the confirm commits, the claim would be made on a pair that owes nothing.
// The record reads the balance row FOR SHARE inside its own transaction, so it waits for the confirm's posting and
// reads what it left. Nothing posts on a record, so two claims by the same debtor must NOT wait for each other.
//
//	go test -tags raceaudit -run "TestInterleave_Record" -v ./backend/services/liability_service/liability_v1/
package liability_v1_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// seedClaim commits a debt of 15.000 owed by selling to the warehouse and one pending claim of it.
func seedClaim(t *testing.T, svc *liability_v1.Service, sourceID uint64) uint64 {
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
		t.Fatalf("seed the claim: %v", err)
	}

	return recorded.Msg.GetPayment().GetId()
}

// THE PROOF: a second claim reading the pair while a confirm is squaring it BLOCKS on the confirm's posting, and once
// the confirm commits it reads the squared pair and is refused — never the 15.000 it would have read before waiting.
func TestInterleave_RecordWaitsForTheConfirmThatSquaresThePair(t *testing.T) {
	h := san_race.New(t, paymentTables...)
	db := h.DB()
	svc := liability_v1.NewService(db, nil, nil, nil)
	ctx := context.Background()

	paymentID := seedClaim(t, svc, 9101)

	var owesErr error

	sched := h.Interleave(t,
		// The confirm's own posting — the payment moves value the opposite way to a fee, so the warehouse is its debtor.
		san_race.Do("A", "A (confirm) posts the payment that squares the pair", func(tx *gorm.DB) error {
			_, postErr := svc.PostEntry(ctx, tx, liability_v1.Posting{
				DebtorTeamID:   warehouse,
				CreditorTeamID: selling,
				Amount:         15000,
				SourceType:     liability_v1.SourceTypePayment,
				SourceID:       paymentID,
			})

			return postErr
		}),
		// ⚠ THIS IS THE WHOLE PROOF. If B returns at once, the record reads the balance before the confirm lands.
		san_race.Block("B", "B (a second claim) reads the pair FOR SHARE", func(tx *gorm.DB) error {
			owesErr = liability_v1.PayerOwes(tx, selling, warehouse)

			return nil
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)

	sched.Report(t)

	if !errors.Is(owesErr, liability_v1.ErrNothingToPay) {
		t.Fatalf("B's check after the confirm committed = %v, want ErrNothingToPay — it acted on the debt it saw "+
			"BEFORE it blocked", owesErr)
	}
}

// AND THE COST IS NOT PAID BY THE DEBTOR: two claims by the same debtor take SHARE locks, which never conflict, so the
// second reads the pair at once while the first is still open.
func TestInterleave_RecordTwoClaimsDoNotQueue(t *testing.T) {
	h := san_race.New(t, paymentTables...)
	db := h.DB()
	svc := liability_v1.NewService(db, nil, nil, nil)

	seedClaim(t, svc, 9102)

	check := func(tx *gorm.DB) error {
		return liability_v1.PayerOwes(tx, selling, warehouse)
	}

	sched := h.Interleave(t,
		san_race.Do("A", "A (a claim) reads the pair FOR SHARE", check),
		san_race.Do("B", "B (another claim) reads the same pair FOR SHARE", check),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)

	sched.Report(t)

	for _, name := range []string{"A (a claim) reads the pair FOR SHARE", "B (another claim) reads the same pair FOR SHARE"} {
		got := sched.Get(name)
		if got.Err != nil || got.Blocked {
			t.Fatalf("%s: err=%v blocked=%v, want an immediate pass — the pair owes 15.000", name, got.Err, got.Blocked)
		}
	}
}
