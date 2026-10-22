//go:build raceaudit

// Concurrency audit for the warehouse transfer's writers (the audit-sql skill). Two staff at B's door, or the selling
// team and a warehouse at the same second, is the normal case (a-transfer-is-locked-before-any-status-change).
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS.
//
//	go test -tags raceaudit -run "TestRace_WarehouseTransfer|TestInterleave_WarehouseTransfer" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

const raceReceiver uint64 = 6

// Children first: the transfer tables reference the ledger's transactions.
var transferTables = append([]string{
	"warehouse_transfer_logs",
	"warehouse_transfer_problem_items",
	"warehouse_transfer_items",
	"warehouse_transfers",
	"warehouse_products",
}, ledgerTables...)

// raceTransferSeed commits stock at A and one empty rack at B, and returns B's rack.
func raceTransferSeed(t *testing.T, db *gorm.DB, perBatch int64, products ...uint64) uint64 {
	t.Helper()

	seedLedgers(t, db, perBatch, products...)

	var rack uint64

	err := db.Raw(`INSERT INTO placements (warehouse_id, code, name) VALUES (?, 'rak-b1', 'rak-b1') RETURNING id`, raceReceiver).
		Scan(&rack).Error
	if err != nil {
		t.Fatalf("seed B's rack: %v", err)
	}

	return rack
}

func raceTransferCreate(svc *inventory_v1.Service, lines ...*inventoryv1.WarehouseTransferLine) (*inventoryv1.WarehouseTransfer, error) {
	res, err := svc.WarehouseTransferCreate(context.Background(), connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
		TeamId: raceOwner, FromWarehouseId: raceWarehouse, ToWarehouseId: raceReceiver, Lines: lines,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetTransfer(), nil
}

// raceShipped commits a transfer of `count` units of product A, processed and shipped.
func raceShipped(t *testing.T, svc *inventory_v1.Service, count int64) *inventoryv1.WarehouseTransfer {
	t.Helper()

	tr, err := raceTransferCreate(svc, wtLine(raceProductA, count))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, err = svc.WarehouseTransferProcess(context.Background(), connect.NewRequest(&inventoryv1.WarehouseTransferProcessRequest{
		TeamId: raceWarehouse, TransferId: tr.GetId(),
	}))
	if err != nil {
		t.Fatalf("process: %v", err)
	}

	_, err = svc.WarehouseTransferShip(context.Background(), connect.NewRequest(&inventoryv1.WarehouseTransferShipRequest{
		TeamId: raceWarehouse, TransferId: tr.GetId(),
	}))
	if err != nil {
		t.Fatalf("ship: %v", err)
	}

	return tr
}

func raceAccept(svc *inventory_v1.Service, tr *inventoryv1.WarehouseTransfer, rack uint64) error {
	item := tr.GetItems()[0]

	_, err := svc.WarehouseTransferAccept(context.Background(), connect.NewRequest(&inventoryv1.WarehouseTransferAcceptRequest{
		TeamId: raceReceiver, TransferId: tr.GetId(),
		Lines: []*inventoryv1.WarehouseTransferCountedLine{{
			ItemId: item.GetId(), ArrivedCount: item.GetCount(),
			Placements: []*inventoryv1.WarehouseTransferPlacement{{PlacementId: rack, Quantity: item.GetCount()}},
		}},
	}))

	return err
}

// ⚠ TWO STAFF AT B'S DOOR. Eight accept the same box at once: exactly one counts it in, seven are refused as already
// accepted, and B holds the box ONCE — without the lock, two accepts of a box of 4 mint 8.
func TestRace_WarehouseTransferAccept_TheBoxIsCountedInOnce(t *testing.T) {
	h := san_race.New(t, transferTables...)
	rack := raceTransferSeed(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())
	tr := raceShipped(t, svc, 4)

	var c codes

	res := h.Race(t, 8, func(int) error {
		err := raceAccept(svc, tr, rack)
		c.add(err)

		if connect.CodeOf(err) == connect.CodeFailedPrecondition {
			return nil
		}

		return err
	})
	res.Report(t)

	if c.got[0] != 1 || c.got[connect.CodeFailedPrecondition] != 7 {
		t.Fatalf("outcomes = %v, want 1 accept and 7 refused", c.got)
	}

	if b, r := unitsAt(t, h.DB(), raceReceiver, raceProductA); b != 4 || r != 4 {
		t.Fatalf("B holds %d / %d after the race, want the box of 4 once", b, r)
	}

	var legs int64
	h.DB().Raw(`SELECT COUNT(*) FROM inventory_transactions WHERE tx_type = 'transfer_in'`).Scan(&legs)
	if legs != 1 {
		t.Fatalf("%d in-legs written, want 1", legs)
	}
}

// ⚠ NEVER SEND WHAT IS NOT THERE, AND NEVER DEADLOCK. 20 units of each product; 16 transfers each want 2 of A and 1 of
// B, half listing them the other way round. Exactly 10 are opened, 6 refused for stock, nobody deadlocks, and A's two
// ledgers end equal.
func TestRace_WarehouseTransferCreate_NeverSendsMoreThanAHolds(t *testing.T) {
	h := san_race.New(t, transferTables...)
	raceTransferSeed(t, h.DB(), 10, raceProductA, raceProductB)
	svc := raceService(h.DB())

	var c codes

	res := h.Race(t, 16, func(i int) error {
		lines := []*inventoryv1.WarehouseTransferLine{wtLine(raceProductA, 2), wtLine(raceProductB, 1)}
		if i%2 == 1 {
			lines[0], lines[1] = lines[1], lines[0]
		}

		_, err := raceTransferCreate(svc, lines...)
		c.add(err)

		if connect.CodeOf(err) == connect.CodeFailedPrecondition {
			return nil
		}

		return err
	})
	res.Report(t)

	if n := res.Count(san_race.Deadlock); n != 0 {
		t.Fatalf("%d creates deadlocked", n)
	}

	if c.got[0] != 10 || c.got[connect.CodeFailedPrecondition] != 6 {
		t.Fatalf("outcomes = %v, want 10 opened and 6 refused for stock", c.got)
	}

	for _, product := range []uint64{raceProductA, raceProductB} {
		if b, r := unitsAt(t, h.DB(), raceWarehouse, product); b != r || b < 0 {
			t.Fatalf("product %d: A's batches hold %d, its racks %d", product, b, r)
		}
	}

	var legs []uint64
	h.DB().Raw(`SELECT id FROM inventory_transactions WHERE tx_type = 'transfer_out'`).Scan(&legs)

	for _, id := range legs {
		err := inventory_ledgers.Verify(h.DB(), id)
		if err != nil {
			t.Fatalf("Verify %d: %v", id, err)
		}
	}
}

// THE TEAM AND A AT THE SAME SECOND. A cancel and A's confirm race on a created transfer: exactly one wins, and the
// stock agrees with whichever it was — back at A after a cancel, still out after a confirm.
func TestRace_WarehouseTransfer_CancelRacingProcessEndsInOne(t *testing.T) {
	h := san_race.New(t, transferTables...)
	raceTransferSeed(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())

	tr, err := raceTransferCreate(svc, wtLine(raceProductA, 4))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	var c codes

	res := h.Race(t, 2, func(i int) error {
		var callErr error

		if i == 0 {
			_, callErr = svc.WarehouseTransferCancel(context.Background(), connect.NewRequest(&inventoryv1.WarehouseTransferCancelRequest{
				TeamId: raceOwner, TransferId: tr.GetId(),
			}))
		} else {
			_, callErr = svc.WarehouseTransferProcess(context.Background(), connect.NewRequest(&inventoryv1.WarehouseTransferProcessRequest{
				TeamId: raceWarehouse, TransferId: tr.GetId(),
			}))
		}

		c.add(callErr)

		if connect.CodeOf(callErr) == connect.CodeFailedPrecondition {
			return nil
		}

		return callErr
	})
	res.Report(t)

	if c.got[0] != 1 || c.got[connect.CodeFailedPrecondition] != 1 {
		t.Fatalf("outcomes = %v, want exactly one of cancel and process", c.got)
	}

	var status string
	h.DB().Raw(`SELECT status FROM warehouse_transfers WHERE id = ?`, tr.GetId()).Scan(&status)

	b, r := unitsAt(t, h.DB(), raceWarehouse, raceProductA)

	switch status {
	case "cancel":
		if b != 20 || r != 20 {
			t.Fatalf("cancelled, but A holds %d / %d, want all 20 back", b, r)
		}
	case "process":
		if b != 16 || r != 16 {
			t.Fatalf("processed, but A holds %d / %d, want 16", b, r)
		}
	default:
		t.Fatalf("status = %q, want cancel or process", status)
	}
}

// THE TEAM GIVES UP AS B COUNTS. Lost and accept race on a shipped box: exactly one wins, and B's stock agrees.
func TestRace_WarehouseTransfer_LostRacingAcceptEndsInOne(t *testing.T) {
	h := san_race.New(t, transferTables...)
	rack := raceTransferSeed(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())
	tr := raceShipped(t, svc, 3)

	var c codes

	res := h.Race(t, 2, func(i int) error {
		var callErr error

		if i == 0 {
			_, callErr = svc.WarehouseTransferMarkLost(context.Background(), connect.NewRequest(&inventoryv1.WarehouseTransferMarkLostRequest{
				TeamId: raceOwner, TransferId: tr.GetId(),
			}))
		} else {
			callErr = raceAccept(svc, tr, rack)
		}

		c.add(callErr)

		if connect.CodeOf(callErr) == connect.CodeFailedPrecondition {
			return nil
		}

		return callErr
	})
	res.Report(t)

	if c.got[0] != 1 || c.got[connect.CodeFailedPrecondition] != 1 {
		t.Fatalf("outcomes = %v, want exactly one of lost and accept", c.got)
	}

	var status string
	h.DB().Raw(`SELECT status FROM warehouse_transfers WHERE id = ?`, tr.GetId()).Scan(&status)

	b, _ := unitsAt(t, h.DB(), raceReceiver, raceProductA)
	if (status == "accepted" && b != 3) || (status == "lost" && b != 0) || (status != "accepted" && status != "lost") {
		t.Fatalf("status %q with B holding %d — they disagree", status, b)
	}
}

// The PROOF: a second accept WAITS on the transfer row the first one holds, and once released sees it accepted.
func TestInterleave_WarehouseTransferAccept_TheSecondWaitsForTheFirst(t *testing.T) {
	h := san_race.New(t, transferTables...)
	rack := raceTransferSeed(t, h.DB(), 10, raceProductA)
	tr := raceShipped(t, raceService(h.DB()), 2)

	sched := h.Interleave(t,
		san_race.Do("A", "Citra accepts the box", func(tx *gorm.DB) error {
			return raceAccept(raceService(tx), tr, rack)
		}),
		san_race.Block("B", "Dodi accepts the same box", func(tx *gorm.DB) error {
			return raceAccept(raceService(tx), tr, rack)
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	second := sched.Get("Dodi accepts the same box")
	if !second.Released {
		t.Fatal("Dodi's accept did not wait for Citra's — the accept does not take the transfer lock")
	}

	if connect.CodeOf(second.Err) != connect.CodeFailedPrecondition {
		t.Fatalf("Dodi's accept: err = %v, want FailedPrecondition — already accepted", second.Err)
	}

	if b, _ := unitsAt(t, h.DB(), raceReceiver, raceProductA); b != 2 {
		t.Fatalf("B holds %d, want the box of 2 once", b)
	}
}
