//go:build raceaudit

// Concurrency audit for OrderTransactionReturn (the audit-sql skill, return_decision.md): an order's return is written
// ONCE per take. Two accepts of one parcel in the same second both reach it; the take's row lock queues the second, which
// then reads the first's claim and answers that return instead of minting again.
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS.
//
//	go test -tags raceaudit -run "TestInterleave_OrderTransactionReturn|TestRace_OrderTransactionReturn" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
)

var returnLedgerTables = append([]string{"warehouse_products"}, ledgerTables...)

// raceReturnSeed commits two batches of product A on two racks and a take of 3 of it — the order's — and answers the
// take and the first rack.
func raceReturnSeed(t *testing.T, db *gorm.DB) (take, rack uint64) {
	t.Helper()

	seedLedgers(t, db, 2, raceProductA)

	res, err := raceService(db).OrderTransactionCreate(context.Background(), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId: raceOwner, IdempotencyKey: "key-race-return", WarehouseId: raceWarehouse,
		Lines: []*inventoryv1.OrderTransactionLine{{ProductId: raceProductA, Quantity: 3}},
	}))
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	err = db.Raw(`SELECT id FROM placements WHERE warehouse_id = ? AND code = 'rak-a'`, raceWarehouse).Scan(&rack).Error
	if err != nil {
		t.Fatalf("the rack: %v", err)
	}

	return res.Msg.GetTransactionId(), rack
}

func raceReturn(db *gorm.DB, take, rack uint64) (*inventoryv1.OrderTransactionReturnResponse, error) {
	res, err := raceService(db).OrderTransactionReturn(context.Background(), connect.NewRequest(&inventoryv1.OrderTransactionReturnRequest{
		TeamId: raceWarehouse, SellingTeamId: raceOwner, TakeTransactionId: take,
		Lines: []*inventoryv1.OrderTransactionReturnLine{{
			ProductId: raceProductA, ReturnProductId: raceProductA, Sound: 2, Missing: 1,
			Placements: []*inventoryv1.OrderTransactionReturnPlacement{{PlacementId: rack, Quantity: 2}},
		}},
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

func returnsWritten(t *testing.T, db *gorm.DB) (returns, claims, doorRows int64) {
	t.Helper()

	db.Raw(`SELECT count(*) FROM inventory_transactions WHERE tx_type = 'return'`).Scan(&returns)
	db.Raw(`SELECT count(*) FROM order_return_checks`).Scan(&claims)
	db.Raw(`SELECT count(*) FROM order_return_problem_items`).Scan(&doorRows)

	return returns, claims, doorRows
}

// THE PROOF THE TAKE'S ROW LOCK HOLDS, and that B RE-READS the claim after it. A has written the return and not
// committed; B's plain claim read found nothing, so it must wait on the take's row, then read A's claim and answer A's
// return (posted = false) — never mint the parcel a second time.
func TestInterleave_OrderTransactionReturn_SecondWaitsOnTheTake(t *testing.T) {
	h := san_race.New(t, returnLedgerTables...)
	take, rack := raceReturnSeed(t, h.DB())

	var (
		a, b       *inventoryv1.OrderTransactionReturnResponse
		aErr, bErr error
	)

	const second = "B returns the same take"

	sched := h.Interleave(t,
		san_race.Do("A", "A returns the take — FOR UPDATE holds its row", func(tx *gorm.DB) error {
			a, aErr = raceReturn(tx, take, rack)

			return nil
		}),
		san_race.Block("B", second, func(tx *gorm.DB) error {
			b, bErr = raceReturn(tx, take, rack)

			return nil
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	step := sched.Get(second)
	if !step.Blocked || !step.Released {
		t.Fatalf("B did not wait on the take's row (blocked=%v released=%v)", step.Blocked, step.Released)
	}

	if aErr != nil || bErr != nil {
		t.Fatalf("A: %v, B: %v — want both answered", aErr, bErr)
	}

	if !a.GetPosted() || b.GetPosted() || b.GetTransactionId() != a.GetTransactionId() || len(b.GetProblems()) != 1 {
		t.Fatalf("A %+v, B %+v — want A posted and B answered with A's return and its door row", a, b)
	}

	if returns, claims, doorRows := returnsWritten(t, h.DB()); returns != 1 || claims != 1 || doorRows != 1 {
		t.Fatalf("%d returns, %d claims, %d door rows — want one of each", returns, claims, doorRows)
	}
}

// EIGHT RETURNS OF ONE TAKE AT ONCE: every one is answered, exactly one posted, one return transaction, and the two sound
// units on the rack once.
func TestRace_OrderTransactionReturn_OnceForEightCallers(t *testing.T) {
	h := san_race.New(t, returnLedgerTables...)

	for round := range 5 {
		for _, table := range returnLedgerTables {
			err := h.DB().Exec(`DELETE FROM ` + table).Error
			if err != nil {
				t.Fatalf("reset %s: %v", table, err)
			}
		}

		take, rack := raceReturnSeed(t, h.DB())

		const n = 8

		answers := make([]*inventoryv1.OrderTransactionReturnResponse, n)

		res := h.Race(t, n, func(i int) error {
			var err error

			answers[i], err = raceReturn(h.DB(), take, rack)

			return err
		})

		if round == 0 {
			res.Report(t)
		}

		posted := 0

		for i, answer := range answers {
			if answer == nil {
				t.Fatalf("round %d: caller %d got no answer", round, i)
			}

			if answer.GetPosted() {
				posted++
			}

			if answer.GetTransactionId() != answers[0].GetTransactionId() {
				t.Fatalf("round %d: callers answered two returns, %d and %d", round, answer.GetTransactionId(),
					answers[0].GetTransactionId())
			}
		}

		if posted != 1 {
			t.Fatalf("round %d: %d callers posted — want exactly one", round, posted)
		}

		if returns, claims, _ := returnsWritten(t, h.DB()); returns != 1 || claims != 1 {
			t.Fatalf("round %d: %d returns, %d claims — want one", round, returns, claims)
		}

		// 2 + 2 on the rack, the take drew 3 (fewest first), 2 came back here.
		var onRacks int64

		h.DB().Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM product_placements WHERE product_id = ?`, raceProductA).Scan(&onRacks)
		if onRacks != 3 {
			t.Fatalf("round %d: %d units on the racks, want 3 — 4 seeded, 3 taken, 2 back once", round, onRacks)
		}
	}
}
