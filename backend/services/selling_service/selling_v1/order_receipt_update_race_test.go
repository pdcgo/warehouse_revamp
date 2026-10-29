//go:build raceaudit

// Concurrency audit for OrderReceiptUpdate (the audit-sql skill) — the-seller-edits-the-resi-until-handover.
//
// The write is one transaction: the order read FOR UPDATE, the status gate, one UPDATE of its row, one note INSERT. Two
// things could go wrong without the lock: two edits each naming a stale OLD in their note (a lost update the timeline
// would then lie about), and an edit landing on a parcel the handover already gave the courier. Both are proved here.
//
//	go test -tags raceaudit -count=20 -run 'TestRace_OrderReceiptUpdate|TestInterleave_OrderReceiptUpdate' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

func raceEdit(svc *selling_v1.Service, orderID uint64, code string) error {
	_, err := svc.OrderReceiptUpdate(context.Background(), connect.NewRequest(&sellingv1.OrderReceiptUpdateRequest{
		TeamId: raceOrderTeam, OrderId: orderID, ReceiptCode: &code,
	}))

	return err
}

// editNotes is the order's note rows, oldest first.
func editNotes(t *testing.T, db *gorm.DB, orderID uint64) []string {
	t.Helper()

	var notes []string

	err := db.Raw(`SELECT note FROM order_timeline_logs WHERE order_id = ? AND status = '' ORDER BY id`, orderID).
		Scan(&notes).Error
	if err != nil {
		t.Fatalf("notes of %d: %v", orderID, err)
	}

	return notes
}

// pickedRaceOrder is a race order the warehouse has confirmed and picked — the handover's starting point.
func pickedRaceOrder(t *testing.T, svc *selling_v1.Service, shopID uint64) uint64 {
	t.Helper()

	orderID := raceOrder(t, svc, shopID)
	moveOrder(t, svc, testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "")
	moveOrder(t, svc, testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_PICKED, "")

	return orderID
}

// Eight edits of one order's number at once, × 10 rounds. They queue on the row: every edit lands, and the notes form
// ONE CHAIN — each note's old is the previous note's new — so no edit read a number another had already replaced.
func TestRace_OrderReceiptUpdate_EditsQueue(t *testing.T) {
	h := orderRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Resi", "RR-1", "shopee")

	const edits = 8

	for round := range 10 {
		orderID := raceOrder(t, svc, shopID)

		res := h.Race(t, edits, func(i int) error {
			return raceEdit(svc, orderID, fmt.Sprintf("JNE-%d", i))
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d edits failed — deadlocks %d", round, res.Failed(), res.Count(san_race.Deadlock))
		}

		notes := editNotes(t, h.DB(), orderID)
		if len(notes) != edits {
			t.Fatalf("round %d: %d notes, want %d", round, len(notes), edits)
		}

		previous := "—"

		for i, note := range notes {
			old, current, ok := strings.Cut(strings.TrimPrefix(note, "Resi: "), " → ")
			if !ok || old != previous {
				t.Fatalf("round %d: note %d is %q, want its old to be %q — an edit read a stale number", round, i, note, previous)
			}

			previous = current
		}

		var stored string

		err := h.DB().Raw(`SELECT receipt FROM orders WHERE id = ?`, orderID).Scan(&stored).Error
		if err != nil || stored != previous {
			t.Fatalf("round %d: the order says %q, the last note %q (err %v)", round, stored, previous, err)
		}
	}
}

// Four edits and the handover at once, × 20 rounds. The handover always moves; each edit either landed before it or
// is refused after it — and every edit that answered success is a note.
func TestRace_OrderReceiptUpdate_AgainstTheHandover(t *testing.T) {
	h := orderRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Resi", "RR-2", "shopee")

	const edits = 4

	for round := range 20 {
		orderID := pickedRaceOrder(t, svc, shopID)

		var shipped *sellingv1.OrderStatusChangeResult

		errs := make([]error, edits)

		res := h.Race(t, edits+1, func(i int) error {
			if i == edits {
				got, err := raceMove(svc, testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING)
				shipped = got

				return err
			}

			errs[i] = raceEdit(svc, orderID, fmt.Sprintf("SPX-%d", i))

			// A refusal after the handover is the answer, not a failure of the race.
			var cerr *connect.Error
			if errors.As(errs[i], &cerr) && cerr.Code() == connect.CodeFailedPrecondition {
				return nil
			}

			return errs[i]
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d calls failed — deadlocks %d", round, res.Failed(), res.Count(san_race.Deadlock))
		}

		if !shipped.GetMoved() {
			t.Fatalf("round %d: the handover was refused: %s", round, shipped.GetRefusedReason())
		}

		landed := 0

		for _, err := range errs {
			if err == nil {
				landed++
			}
		}

		if got := len(editNotes(t, h.DB(), orderID)); got != landed {
			t.Fatalf("round %d: %d edits answered success, %d notes written", round, landed, got)
		}
	}
}

// THE PROOF AN EDIT NEVER LANDS ON A HANDED-OVER PARCEL. A holds the order FOR UPDATE moving it to shipping and has
// not committed; B's edit must wait on that row, then read `shipping` and be refused — not write the number the courier
// never saw.
func TestInterleave_OrderReceiptUpdate_WaitsForTheHandover(t *testing.T) {
	h := orderRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Resi", "RR-3", "shopee")

	orderID := pickedRaceOrder(t, svc, shopID)

	var a *sellingv1.OrderStatusChangeResult

	const edit = "B edits the number of the same order"

	sched := h.Interleave(t,
		san_race.Do("A", "A hands the parcel over — FOR UPDATE holds its row", func(tx *gorm.DB) error {
			got, err := raceMove(newService(t, tx), testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING)
			a = got

			return err
		}),
		san_race.Block("B", edit, func(tx *gorm.DB) error {
			return raceEdit(newService(t, tx), orderID, "SPX-LATE")
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	if !a.GetMoved() {
		t.Fatalf("A was refused: %s", a.GetRefusedReason())
	}

	step := sched.Get(edit)

	var cerr *connect.Error
	if !step.Blocked || !step.Released || !errors.As(step.Err, &cerr) || cerr.Code() != connect.CodeFailedPrecondition {
		t.Fatalf("B's edit: blocked=%v released=%v err=%v — want it to wait on the handover and then be refused",
			step.Blocked, step.Released, step.Err)
	}

	if got := editNotes(t, h.DB(), orderID); len(got) != 0 {
		t.Fatalf("notes after a refused edit: %v", got)
	}
}
