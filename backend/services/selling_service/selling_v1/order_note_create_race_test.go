//go:build raceaudit

// Concurrency audit for OrderNoteCreate (the audit-sql skill) — a-note-is-a-timeline-row.
//
// The write is a scoped read of one order and one INSERT, no transaction, no explicit lock. The one lock it takes is
// the INSERT's foreign-key check: FOR KEY SHARE on the order's row, which conflicts with the FOR UPDATE a status move
// or a cancel holds. So what is proved here is that a note WAITS for a move in flight rather than being lost, and that
// holding one lock it can never be half of a deadlock.
//
//	go test -tags raceaudit -count=20 -run 'TestRace_OrderNoteCreate|TestInterleave_OrderNoteCreate' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

func raceNote(svc *selling_v1.Service, teamID, orderID uint64, note string) error {
	_, err := svc.OrderNoteCreate(context.Background(), connect.NewRequest(&sellingv1.OrderNoteCreateRequest{
		TeamId: teamID, OrderId: orderID, Note: note,
	}))

	return err
}

// noteCount is how many note rows (no status) the order has from `from`.
func noteCount(t *testing.T, db *gorm.DB, orderID uint64, from string) int64 {
	t.Helper()

	var n int64

	err := db.Raw(`SELECT count(*) FROM order_timeline_logs WHERE order_id = ? AND status = '' AND "from" = ?`,
		orderID, from).Scan(&n).Error
	if err != nil {
		t.Fatalf("count notes of %d from %s: %v", orderID, from, err)
	}

	return n
}

// Both ends write four notes each on one order while its warehouse moves it — nine callers at once, × 10 rounds.
// Every note lands, each from the side its scope says, and the move is written once: a note neither blocks the move
// out nor is swallowed by it.
func TestRace_OrderNoteCreate_NotesAndAMoveAtOnce(t *testing.T) {
	h := orderRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Notes", "RN-1", "shopee")

	const notes = 8

	for round := range 10 {
		orderID := raceOrder(t, svc, shopID)
		moveOrder(t, svc, testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "")

		var moved *sellingv1.OrderStatusChangeResult

		res := h.Race(t, notes+1, func(i int) error {
			switch {
			case i == notes:
				got, err := raceMove(svc, testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_PICKED)
				moved = got

				return err
			case i%2 == 0:
				return raceNote(svc, raceOrderTeam, orderID, "from the seller")
			default:
				return raceNote(svc, testWarehouse, orderID, "from the crew")
			}
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d calls failed — deadlocks %d", round, res.Failed(), res.Count(san_race.Deadlock))
		}

		if !moved.GetMoved() {
			t.Fatalf("round %d: the move was refused: %s", round, moved.GetRefusedReason())
		}

		selling, warehouse := noteCount(t, h.DB(), orderID, "selling"), noteCount(t, h.DB(), orderID, "warehouse")
		if selling != notes/2 || warehouse != notes/2 {
			t.Fatalf("round %d: %d notes from selling, %d from warehouse — want %d each", round, selling, warehouse, notes/2)
		}

		if got := eventCount(t, h.DB(), orderID, "picked"); got != 1 {
			t.Fatalf("round %d: %d picked rows — want one", round, got)
		}
	}
}

// Two batch moves over the same two orders in OPPOSITE orders, with notes on both orders in the same second, × 20
// rounds. A note holds one lock, so it cannot close a cycle — the count of deadlocks must stay 0.
func TestRace_OrderNoteCreate_AgainstOppositeBatches(t *testing.T) {
	h := orderRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Notes", "RN-2", "shopee")

	for round := range 20 {
		first, second := raceOrder(t, svc, shopID), raceOrder(t, svc, shopID)

		batch := func(ids ...uint64) error {
			_, err := svc.OrderStatusChange(context.Background(), connect.NewRequest(&sellingv1.OrderStatusChangeRequest{
				TeamId: testWarehouse, OrderIds: ids, To: sellingv1.OrderStatus_ORDER_STATUS_PROCESSED,
			}))

			return err
		}

		res := h.Race(t, 6, func(i int) error {
			switch i {
			case 0:
				return batch(first, second)
			case 1:
				return batch(second, first)
			case 2, 3:
				return raceNote(svc, raceOrderTeam, first, "note on the first")
			default:
				return raceNote(svc, testWarehouse, second, "note on the second")
			}
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Count(san_race.Deadlock) > 0 || res.Failed() > 0 {
			t.Fatalf("round %d: %d failed, %d deadlocks", round, res.Failed(), res.Count(san_race.Deadlock))
		}

		for _, id := range []uint64{first, second} {
			if got := eventCount(t, h.DB(), id, "processed"); got != 1 {
				t.Fatalf("round %d: order %d has %d processed rows — want one", round, id, got)
			}
		}

		if noteCount(t, h.DB(), first, "selling") != 2 || noteCount(t, h.DB(), second, "warehouse") != 2 {
			t.Fatalf("round %d: a note was lost", round)
		}
	}
}

// THE PROOF THE NOTE WAITS. A move holds the order's row FOR UPDATE and has not committed; B's note must wait on it
// (its foreign-key check is FOR KEY SHARE on that row), then land once A commits — never refused, never lost.
func TestInterleave_OrderNoteCreate_WaitsForAMoveInFlight(t *testing.T) {
	h := orderRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Notes", "RN-3", "shopee")

	orderID := raceOrder(t, svc, shopID)
	moveOrder(t, svc, testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "")

	var a *sellingv1.OrderStatusChangeResult

	const note = "B writes a note on the same order"

	sched := h.Interleave(t,
		san_race.Do("A", "A picks the order — FOR UPDATE holds its row", func(tx *gorm.DB) error {
			got, err := raceMove(newService(t, tx), testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_PICKED)
			a = got

			return err
		}),
		san_race.Block("B", note, func(tx *gorm.DB) error {
			return raceNote(newService(t, tx), testWarehouse, orderID, "no goods on Rak A")
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	step := sched.Get(note)
	if !step.Blocked || !step.Released || step.Err != nil {
		t.Fatalf("B's note: blocked=%v released=%v err=%v — want it to wait on the move and then land",
			step.Blocked, step.Released, step.Err)
	}

	if !a.GetMoved() {
		t.Fatalf("A was refused: %s", a.GetRefusedReason())
	}

	if got := noteCount(t, h.DB(), orderID, "warehouse"); got != 1 {
		t.Fatalf("%d warehouse notes after the wait — want one", got)
	}
}

// The other direction: a note's INSERT not yet committed holds KEY SHARE on the order, so a move's FOR UPDATE waits
// for it. In production the note commits on its own statement, so this wait is that one INSERT long.
func TestInterleave_OrderNoteCreate_AMoveWaitsForANoteInFlight(t *testing.T) {
	h := orderRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Notes", "RN-4", "shopee")

	orderID := raceOrder(t, svc, shopID)

	var b *sellingv1.OrderStatusChangeResult

	const move = "B confirms the order"

	sched := h.Interleave(t,
		san_race.Do("A", "A writes a note — its FK check holds KEY SHARE on the order", func(tx *gorm.DB) error {
			return raceNote(newService(t, tx), raceOrderTeam, orderID, "buyer asks for the glass one wrapped")
		}),
		san_race.Block("B", move, func(tx *gorm.DB) error {
			got, err := raceMove(newService(t, tx), testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED)
			b = got

			return err
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	step := sched.Get(move)
	if !step.Blocked || !step.Released || step.Err != nil {
		t.Fatalf("B's move: blocked=%v released=%v err=%v — want it to wait on the note and then move",
			step.Blocked, step.Released, step.Err)
	}

	if !b.GetMoved() {
		t.Fatalf("B was refused: %s", b.GetRefusedReason())
	}

	if noteCount(t, h.DB(), orderID, "selling") != 1 || eventCount(t, h.DB(), orderID, "processed") != 1 {
		t.Fatal("after both commits the order should have one note and one processed row")
	}
}
