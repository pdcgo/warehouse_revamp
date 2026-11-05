//go:build raceaudit

// Concurrency audit for the restock's question to financial_account_service (a-restock-names-its-paying-account):
// RestockRequestCreate and RestockRequestUpdate ask PayingAccounts.Account — in-process today, a network RPC once the
// services split — and must ask it BEFORE any transaction, exactly like the supplier question beside it.
//
// Helpers carry a `raceAccount` prefix so they cannot collide with the other build-tagged files; the seed and the
// table list are restock_request_supplier_race_test.go's.
//
//	go test -tags raceaudit -p 1 -run 'TestRace_RestockRequest.*Account' -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// raceAccountSlow stands in for financial_account_service: every answer is "active, operational" after `latency`.
// `during`, if set, runs at the start of the call and records what the database looks like while it is in flight.
type raceAccountSlow struct {
	latency time.Duration
	called  chan struct{}
	during  func()
}

func (f *raceAccountSlow) Account(context.Context, uint64, uint64) (inventory_v1.PayingAccount, bool, error) {
	if f.during != nil {
		f.during()
	}

	if f.called != nil {
		select {
		case <-f.called:
		default:
			close(f.called)
		}
	}

	time.Sleep(f.latency)

	return inventory_v1.PayingAccount{Name: "BCA Operasional", Active: true, Operational: true}, true, nil
}

// While financial_account_service is being asked, the create has not opened its transaction: no backend idle in
// transaction, no lock.
func TestRace_RestockRequestCreate_HoldsNoTransactionDuringTheAccountCall(t *testing.T) {
	h := san_race.New(t, raceRestockTables...)

	var (
		idleInTx, locks int64
		probeErr        error
	)

	probe := &raceAccountSlow{latency: time.Millisecond}
	probe.during = func() {
		idleInTx, locks, probeErr = raceRestockHeldLocks(h.DB())
	}

	_, err := inventory_v1.NewService(h.DB(), nil, nil, nil, nil, nil, nil, probe).RestockRequestCreate(ctxUser(1),
		connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: raceRestockTeam, WarehouseId: raceRestockWarehouse, FinanceAccountId: 41, Items: raceRestockItems(),
		}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if probeErr != nil {
		t.Fatalf("probe: %v", probeErr)
	}

	t.Logf("during the account call: %d backend(s) idle in transaction, holding %d lock(s)", idleInTx, locks)

	if idleInTx != 0 || locks != 0 {
		t.Fatalf("the create holds a transaction (%d) or locks (%d) across the account call", idleInTx, locks)
	}
}

// financial_account_service takes 800 ms to answer an edit that moves the payment; a cancel of the same restock sent
// 50 ms into that does NOT wait it out. The edit, resuming after the answer, finds the restock cancelled — the serial
// outcome of "cancel, then edit" — and refuses with FailedPrecondition.
func TestRace_RestockRequestUpdate_ACancelDoesNotWaitForTheAccountRoundTrip(t *testing.T) {
	h := san_race.New(t, raceRestockTables...)
	reqID := raceRestockSeed(t, h.DB())

	const latency = 800 * time.Millisecond

	slow := &raceAccountSlow{latency: latency, called: make(chan struct{})}
	updater := inventory_v1.NewService(h.DB(), nil, nil, nil, nil, nil, nil, slow)
	canceller := inventory_v1.NewService(h.DB(), nil, nil, nil, nil, nil, nil, nil)
	ctx := ctxUser(1)

	res := h.Race(t, 2, func(i int) error {
		if i == 0 {
			_, err := updater.RestockRequestUpdate(ctx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
				FinanceAccountId: 41,
				TeamId:           raceRestockTeam, RequestId: reqID, WarehouseId: raceRestockWarehouse,
				Items: raceRestockItems(),
			}))

			return err
		}

		select {
		case <-slow.called:
		case <-time.After(5 * time.Second):
			t.Error("the edit never asked financial_account_service")
		}

		time.Sleep(50 * time.Millisecond)

		_, err := canceller.RestockRequestCancel(ctx,
			connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{TeamId: raceRestockTeam, RequestId: reqID}))

		return err
	})
	res.Report(t)

	update := res.Outcomes[0]
	cancel := res.Outcomes[1]

	t.Logf("update took %v (%v) · cancel took %v (%v) — account latency %v",
		update.Wall.Round(time.Millisecond), update.Err, cancel.Wall.Round(time.Millisecond), cancel.Err, latency)

	if cancel.Err != nil {
		t.Fatalf("cancel: %v", cancel.Err)
	}

	if cancel.Wall > latency/2 {
		t.Fatalf("cancel took %v — it waited on the account round-trip", cancel.Wall)
	}

	if connect.CodeOf(update.Err) != connect.CodeFailedPrecondition {
		t.Fatalf("the edit after a committed cancel = %v, want FailedPrecondition", update.Err)
	}
}
