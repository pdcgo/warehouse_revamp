//go:build raceaudit

// Concurrency audit for the transfer's question to financial_account_service (a-transfer-names-its-paying-account):
// WarehouseTransferCreate and WarehouseTransferUpdate ask PayingAccounts.Account — in-process today, a network RPC once
// the services split — and must ask it BEFORE any transaction, exactly like the restock beside them
// (restock_request_account_race_test.go, whose raceAccountSlow this reuses).
//
//	go test -tags raceaudit -p 1 -run 'TestRace_WarehouseTransfer.*Account' -v ./backend/services/inventory_service/inventory_v1/
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

// While financial_account_service is being asked, the create has not opened its transaction: no backend idle in
// transaction, no lock — and A's batches are not held while the round-trip runs.
func TestRace_WarehouseTransferCreate_HoldsNoTransactionDuringTheAccountCall(t *testing.T) {
	h := san_race.New(t, transferTables...)
	raceTransferSeed(t, h.DB(), 10, raceProductA)

	var (
		idleInTx, locks int64
		probeErr        error
	)

	probe := &raceAccountSlow{latency: time.Millisecond}
	probe.during = func() {
		idleInTx, locks, probeErr = raceRestockHeldLocks(h.DB())
	}

	_, err := inventory_v1.NewService(h.DB(), nil, nil, nil, nil, nil, nil, probe).WarehouseTransferCreate(context.Background(),
		connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
			TeamId: raceOwner, FromWarehouseId: raceWarehouse, ToWarehouseId: raceReceiver,
			Lines: []*inventoryv1.WarehouseTransferLine{wtLine(raceProductA, 1)}, ShipmentCost: 18000, FinanceAccountId: 41,
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

// financial_account_service takes 800 ms to answer an edit that moves the shipping to another account; a cancel of the
// same transfer sent 50 ms into that does NOT wait it out. The edit, resuming after the answer, finds the transfer
// cancelled — the serial outcome of "cancel, then edit" — and refuses with FailedPrecondition.
func TestRace_WarehouseTransferUpdate_ACancelDoesNotWaitForTheAccountRoundTrip(t *testing.T) {
	h := san_race.New(t, transferTables...)
	raceTransferSeed(t, h.DB(), 10, raceProductA)

	plain := inventory_v1.NewService(h.DB(), nil, nil, nil, nil, nil, nil, nil)

	tr, err := raceTransferCreate(plain, wtLine(raceProductA, 1))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	const latency = 800 * time.Millisecond

	slow := &raceAccountSlow{latency: latency, called: make(chan struct{})}
	updater := inventory_v1.NewService(h.DB(), nil, nil, nil, nil, nil, nil, slow)
	ctx := context.Background()

	res := h.Race(t, 2, func(i int) error {
		if i == 0 {
			_, updateErr := updater.WarehouseTransferUpdate(ctx, connect.NewRequest(&inventoryv1.WarehouseTransferUpdateRequest{
				TeamId: raceOwner, TransferId: tr.GetId(), ShipmentCost: 18000, FinanceAccountId: 41, Note: "packed",
			}))

			return updateErr
		}

		select {
		case <-slow.called:
		case <-time.After(5 * time.Second):
			t.Error("the edit never asked financial_account_service")
		}

		time.Sleep(50 * time.Millisecond)

		_, cancelErr := plain.WarehouseTransferCancel(ctx,
			connect.NewRequest(&inventoryv1.WarehouseTransferCancelRequest{TeamId: raceOwner, TransferId: tr.GetId()}))

		return cancelErr
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
