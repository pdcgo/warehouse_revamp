//go:build raceaudit

// Concurrency audit for KOREKSI JUMLAH TERIMA — RestockReceivedCountCorrect and WarehouseTransferReceivedCountCorrect
// (adjustment_decision.md#the-received-count-prototype-is-accepted). The cases that matter: two people correcting the
// same line at once (the expected received count is the guard, judged under the parent row's lock), a correction racing
// the order takes that draw the same batch, and a correction meeting a count that starts on its rack.
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS.
//
//	go test -tags raceaudit -p 1 -count=1 -run 'TestRace_.*ReceivedCountCorrect|TestInterleave_.*ReceivedCountCorrect' -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// raceCountTables is everything a restock, a transfer and their corrections write — children first.
var raceCountTables = append([]string{
	"restock_count_corrections",
	"warehouse_transfer_count_corrections",
	"warehouse_transfer_logs",
	"warehouse_transfer_problem_items",
	"warehouse_transfer_items",
	"warehouse_transfers",
	"restock_problem_items",
	"restock_logs",
	"restock_items",
	"restocks",
	"warehouse_products",
}, ledgerTables...)

// raceCountOwner is the receiving warehouse's Owner, as the interceptor leaves the request.
func raceCountOwner(warehouse uint64) context.Context {
	return ctxAs(70, warehouse, role_basev1.Role_ROLE_WAREHOUSE_OWNER)
}

// raceCountSeed commits a restock of `count` product A to Gudang 5, accepted whole onto one rack; it returns the
// restock, its line and the rack.
func raceCountSeed(t *testing.T, db *gorm.DB, count int64) (uint64, uint64, uint64) {
	t.Helper()

	svc := raceService(db)
	rack := newRack(t, svc, raceWarehouse, "rak-a")

	created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: raceOwner, WarehouseId: raceWarehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: raceProductA, ProductCode: "A", Name: "A", Count: count, Total: float64(1000 * count)},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	restock := created.Msg.GetRequest()
	item := restock.GetItems()[0]

	_, err = svc.RestockRequestAccept(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: raceWarehouse, RequestId: restock.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: item.GetId(), ReceivedCount: count, Placements: placedOn(rack, count)},
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	return restock.GetId(), item.GetId(), rack
}

func raceCorrect(svc *inventory_v1.Service, restockID, itemID, rack uint64, expected, real int64) error {
	_, err := svc.RestockReceivedCountCorrect(raceCountOwner(raceWarehouse), connect.NewRequest(&inventoryv1.RestockReceivedCountCorrectRequest{
		TeamId: raceWarehouse, RequestId: restockID, Reason: "race",
		Lines: []*inventoryv1.ReceivedCountLine{{
			ItemId: itemID, ExpectedReceivedCount: expected, ReceivedCount: real, PlacementId: rack,
		}},
	}))

	return err
}

// raceReceived is a restock line's received count now.
func raceReceived(t *testing.T, db *gorm.DB, itemID uint64) int64 {
	t.Helper()

	var n int64

	err := db.Raw(`SELECT received_count FROM restock_items WHERE id = ?`, itemID).Scan(&n).Error
	if err != nil {
		t.Fatalf("received: %v", err)
	}

	return n
}

// raceCountConsistent is the end state every race must leave: both ledgers agree, every transaction verifies, the
// reports equal the ledger, and the line's count equals the accept's minus every unit the corrections took out.
func raceCountConsistent(t *testing.T, db *gorm.DB, itemID uint64, accepted int64) {
	t.Helper()

	verifyEveryTransaction(t, db)

	if b, r := stockOf(t, db, raceProductA); b != r {
		t.Fatalf("batches hold %d, racks %d — the two ledgers drifted apart", b, r)
	}

	ledgerMatchesReport(t, db)

	var out int64

	err := db.Raw(`SELECT COALESCE(SUM(units_out), 0) FROM restock_count_corrections WHERE restock_item_id = ?`, itemID).
		Scan(&out).Error
	if err != nil {
		t.Fatalf("units out: %v", err)
	}

	if got := raceReceived(t, db, itemID); got != accepted-out {
		t.Fatalf("the line reads %d, the accept's %d minus %d out says %d", got, accepted, out, accepted-out)
	}
}

// ⚠ TWO PEOPLE CORRECT THE SAME LINE AT ONCE. Eight open the form on the same received count and save different ones:
// exactly ONE lands, seven are refused as a stale form — never two corrections off the same count. ×4 rounds.
func TestRace_RestockReceivedCountCorrect_TwoCorrectionsAtOnceOneWins(t *testing.T) {
	h := san_race.New(t, raceCountTables...)
	restockID, itemID, rack := raceCountSeed(t, h.DB(), 10)
	svc := raceService(h.DB())

	for round := range 4 {
		now := raceReceived(t, h.DB(), itemID)

		var c codes

		res := h.Race(t, 8, func(i int) error {
			real := now - 1
			if i%2 == 1 {
				real = now - 2
			}

			err := raceCorrect(svc, restockID, itemID, rack, now, real)
			c.add(err)

			if connect.CodeOf(err) == connect.CodeFailedPrecondition {
				return nil
			}

			return err
		})
		res.Report(t)

		if n := res.Count(san_race.Deadlock); n != 0 {
			t.Fatalf("round %d: %d corrections deadlocked", round, n)
		}

		if c.got[0] != 1 || c.got[connect.CodeFailedPrecondition] != 7 {
			t.Fatalf("round %d: outcomes = %v, want one landed and seven refused as stale", round, c.got)
		}
	}

	var corrections int64
	h.DB().Model(&models.InventoryTransaction{}).Where("tx_type = ?", models.TxAdjustment).Count(&corrections)

	if corrections != 4 {
		t.Fatalf("%d correction transactions over 4 rounds, want 4", corrections)
	}

	raceCountConsistent(t, h.DB(), itemID, 10)
}

// A CORRECTION RACING ORDER TAKES ON THE SAME BATCH. Each round one correction taking a unit out (on the count read
// before it) and three takes of one unit start together, the correction delayed round%5 ms so both orders are hit:
// nothing deadlocks, nothing fails, every correction lands (nothing else moves the count), and the ledgers agree.
func TestRace_RestockReceivedCountCorrect_RacingOrderTakesKeepsTheLedgersConsistent(t *testing.T) {
	h := san_race.New(t, raceCountTables...)
	restockID, itemID, rack := raceCountSeed(t, h.DB(), 30)
	svc := raceService(h.DB())

	landed := 0

	for round := range 6 {
		now := raceReceived(t, h.DB(), itemID)

		var c codes

		res := h.Race(t, 4, func(i int) error {
			if i == 0 {
				time.Sleep(time.Duration(round%5) * time.Millisecond)

				err := raceCorrect(svc, restockID, itemID, rack, now, now-1)
				c.add(err)

				return err
			}

			return raceTake(svc, fmt.Sprintf("RC-%d-%d", round, i), &inventoryv1.OrderTransactionLine{ProductId: raceProductA, Quantity: 1})
		})
		res.Report(t)

		if n := res.Count(san_race.Deadlock); n != 0 {
			t.Fatalf("round %d: %d callers deadlocked", round, n)
		}

		if n := res.Failed(); n != 0 {
			t.Fatalf("round %d: %d callers failed", round, n)
		}

		landed += c.got[0]
	}

	if landed != 6 {
		t.Fatalf("%d of 6 corrections landed among the takes, want all 6", landed)
	}

	// 30 in, 6 corrected out, 18 taken.
	if b, _ := stockOf(t, h.DB(), raceProductA); b != 6 {
		t.Fatalf("product A holds %d, want 30 − 6 − 18 = 6", b)
	}

	raceCountConsistent(t, h.DB(), itemID, 30)
}

// A COUNT STARTS WHILE A CORRECTION HOLDS THE RACK: the count's FOR SHARE on the shelf rows waits for the correction's
// FOR UPDATE, and once it commits the count snapshots the corrected units — never the units before.
func TestInterleave_RestockReceivedCountCorrect_ACountWaitsAndSnapshotsTheCorrection(t *testing.T) {
	h := san_race.New(t, raceCountTables...)
	restockID, itemID, rack := raceCountSeed(t, h.DB(), 10)

	var aErr, bErr error

	const second = "B starts a count on the rack"

	sched := h.Interleave(t,
		san_race.Do("A", "A corrects 10 → 8 — the batch and the rack row FOR UPDATE", func(tx *gorm.DB) error {
			aErr = raceCorrect(raceService(tx), restockID, itemID, rack, 10, 8)

			return nil
		}),
		san_race.Block("B", second, func(tx *gorm.DB) error {
			_, bErr = raceService(tx).OpnameSessionCreate(ctxAs(43, raceWarehouse, role_basev1.Role_ROLE_WAREHOUSE_ADMIN),
				connect.NewRequest(&inventoryv1.OpnameSessionCreateRequest{
					TeamId: raceWarehouse, Plan: inventoryv1.OpnamePlan_OPNAME_PLAN_PLACEMENT, FilterPlacementId: rack,
				}))

			return nil
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	step := sched.Get(second)
	if !step.Blocked || !step.Released {
		t.Fatalf("the count did not wait on the correction's rack row (blocked=%v released=%v)", step.Blocked, step.Released)
	}

	if aErr != nil || bErr != nil {
		t.Fatalf("correction: %v, count: %v", aErr, bErr)
	}

	var system int64
	h.DB().Raw(`SELECT system_stock_count FROM opname_session_snapshots WHERE placement_id = ? AND product_id = ?`,
		rack, raceProductA).Scan(&system)

	if system != 8 {
		t.Fatalf("the count snapshotted %d, want the corrected 8", system)
	}

	raceCountConsistent(t, h.DB(), itemID, 10)
}

// A CORRECTION MEETS A COUNT THAT STARTED FIRST: the correction's FOR UPDATE on the rack row waits for the count's FOR
// SHARE, and once the count commits the correction reads its lock under the rack lock and is refused, naming it — the
// count's snapshot stays true (a-lock-stops-sales-and-cancels-too).
func TestInterleave_RestockReceivedCountCorrect_ACorrectionWaitsAndIsRefusedByTheCount(t *testing.T) {
	h := san_race.New(t, raceCountTables...)
	restockID, itemID, rack := raceCountSeed(t, h.DB(), 10)

	var aErr, bErr error

	const second = "B corrects 10 → 8 on the counted rack"

	sched := h.Interleave(t,
		san_race.Do("A", "A starts a count on the rack — the shelf rows FOR SHARE", func(tx *gorm.DB) error {
			_, aErr = raceService(tx).OpnameSessionCreate(ctxAs(43, raceWarehouse, role_basev1.Role_ROLE_WAREHOUSE_ADMIN),
				connect.NewRequest(&inventoryv1.OpnameSessionCreateRequest{
					TeamId: raceWarehouse, Plan: inventoryv1.OpnamePlan_OPNAME_PLAN_PLACEMENT, FilterPlacementId: rack,
				}))

			return nil
		}),
		san_race.Block("B", second, func(tx *gorm.DB) error {
			bErr = raceCorrect(raceService(tx), restockID, itemID, rack, 10, 8)

			return nil
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	step := sched.Get(second)
	if !step.Blocked || !step.Released {
		t.Fatalf("the correction did not wait on the count's shelf rows (blocked=%v released=%v)", step.Blocked, step.Released)
	}

	if aErr != nil || connect.CodeOf(bErr) != connect.CodeFailedPrecondition {
		t.Fatalf("count: %v, correction: %v — want the count and the correction refused", aErr, bErr)
	}

	if got := raceReceived(t, h.DB(), itemID); got != 10 {
		t.Fatalf("the line reads %d, want the accept's 10", got)
	}

	raceCountConsistent(t, h.DB(), itemID, 10)
}

// ⚠ TWO PEOPLE AT B CORRECT THE SAME TRANSFER LINE AT ONCE: one lands, seven are refused as stale; ×3 rounds; B's
// batches and racks agree and every transaction verifies.
func TestRace_WarehouseTransferReceivedCountCorrect_TwoCorrectionsAtOnceOneWins(t *testing.T) {
	h := san_race.New(t, raceCountTables...)
	rack := raceTransferSeed(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())

	tr := raceShipped(t, svc, 8)

	err := raceAccept(svc, tr, rack)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	item := tr.GetItems()[0]

	arrived := func() int64 {
		var n int64
		h.DB().Raw(`SELECT arrived_count FROM warehouse_transfer_items WHERE id = ?`, item.GetId()).Scan(&n)

		return n
	}

	for round := range 3 {
		now := arrived()

		var c codes

		res := h.Race(t, 8, func(i int) error {
			_, err := svc.WarehouseTransferReceivedCountCorrect(raceCountOwner(raceReceiver),
				connect.NewRequest(&inventoryv1.WarehouseTransferReceivedCountCorrectRequest{
					TeamId: raceReceiver, TransferId: tr.GetId(), Reason: "race",
					Lines: []*inventoryv1.ReceivedCountLine{{
						ItemId: item.GetId(), ExpectedReceivedCount: now, ReceivedCount: now - 1 - int64(i%2), PlacementId: rack,
					}},
				}))
			c.add(err)

			if connect.CodeOf(err) == connect.CodeFailedPrecondition {
				return nil
			}

			return err
		})
		res.Report(t)

		if n := res.Count(san_race.Deadlock); n != 0 {
			t.Fatalf("round %d: %d deadlocked", round, n)
		}

		if c.got[0] != 1 || c.got[connect.CodeFailedPrecondition] != 7 {
			t.Fatalf("round %d: outcomes = %v, want one landed and seven stale", round, c.got)
		}
	}

	verifyEveryTransaction(t, h.DB())
	ledgerMatchesReport(t, h.DB())

	var out int64
	h.DB().Raw(`SELECT COALESCE(SUM(units_out), 0) FROM warehouse_transfer_count_corrections WHERE transfer_item_id = ?`,
		item.GetId()).Scan(&out)

	if b, r := unitsAt(t, h.DB(), raceReceiver, raceProductA); b != r || b != 8-out || arrived() != 8-out {
		t.Fatalf("B holds %d / %d, the line %d — want all 8 − %d", b, r, arrived(), out)
	}
}
