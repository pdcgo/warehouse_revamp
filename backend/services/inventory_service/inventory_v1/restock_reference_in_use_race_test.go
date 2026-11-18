//go:build raceaudit

// Concurrency audit for a-reference-in-use-stops-the-restock-form's server half: two saves of one resi or one Order ID
// at the same second. The form's own check asks the list BEFORE the save, so two people (or two tabs) both see "free";
// only inventory 00048's unique indexes stand between them, and exactly one of them may win. The loser is AlreadyExists
// naming the winner.
//
//	go test -tags raceaudit -p 1 -run 'TestRace_RestockReference' -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// raceRefRounds is how many simultaneous pairs each test releases — the race is probabilistic, so one pair proves
// little; every round must end one winner, one AlreadyExists.
const raceRefRounds = 20

// raceRefHolder reads the refusal's holder of `ref`, or 0.
func raceRefHolder(err error, ref inventoryv1.RestockReference) uint64 {
	var cerr *connect.Error
	if !errors.As(err, &cerr) {
		return 0
	}

	for _, d := range cerr.Details() {
		v, valueErr := d.Value()
		if valueErr != nil {
			continue
		}

		inUse, ok := v.(*inventoryv1.RestockReferenceInUse)
		if !ok {
			continue
		}

		for _, h := range inUse.GetHeld() {
			if h.GetReference() == ref {
				return h.GetHolderId()
			}
		}
	}

	return 0
}

// raceRefOneWins asserts a round's two outcomes: one created restock `ids[winner]`, one AlreadyExists naming it.
func raceRefOneWins(t *testing.T, round int, res san_race.Results, ids []uint64, ref inventoryv1.RestockReference) {
	t.Helper()

	won, lost := -1, -1

	for i, o := range res.Outcomes {
		switch {
		case o.Err == nil:
			won = i
		case connect.CodeOf(o.Err) == connect.CodeAlreadyExists:
			lost = i
		default:
			t.Fatalf("round %d caller %d: %v — want a win or AlreadyExists", round, i, o.Err)
		}
	}

	if won < 0 || lost < 0 {
		res.Report(t)
		t.Fatalf("round %d: winner %d, loser %d — exactly one save of one reference may pass", round, won, lost)
	}

	if got := raceRefHolder(res.Outcomes[lost].Err, ref); got != ids[won] {
		t.Fatalf("round %d: the refusal names restock %d, want the winner %d (%v)", round, got, ids[won], res.Outcomes[lost].Err)
	}
}

// Two creates with ONE Order ID — typed differently, letter case and spaces — at the same instant: one restock.
func TestRace_RestockReference_TwoCreatesOfOneOrderID(t *testing.T) {
	h := san_race.New(t, raceRestockTables...)
	svc := inventory_v1.NewService(h.DB(), nil, nil, nil, nil, nil, nil, nil, nil, nil)

	for round := range raceRefRounds {
		orderID := "INV/RACE/" + strconv.Itoa(round)
		typed := []string{orderID, "  " + strings.ToLower(orderID) + " "}
		ids := make([]uint64, 2)

		res := h.Race(t, 2, func(i int) error {
			created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
				TeamId: raceRestockTeam, WarehouseId: raceRestockWarehouse, Items: raceRestockItems(),
				InvoiceRefId: typed[i], Receipt: "JNE-RACE-" + strconv.Itoa(round) + "-" + strconv.Itoa(i),
			}))
			if err != nil {
				return err
			}

			ids[i] = created.Msg.GetRequest().GetId()

			return nil
		})

		raceRefOneWins(t, round, res, ids, inventoryv1.RestockReference_RESTOCK_REFERENCE_INVOICE_REF)
	}

	var n int64

	h.DB().Raw(`SELECT count(*) FROM restocks WHERE team_id = ?`, raceRestockTeam).Scan(&n)
	if n != raceRefRounds {
		t.Fatalf("restocks = %d, want one per round (%d)", n, raceRefRounds)
	}
}

// The same with ONE resi.
func TestRace_RestockReference_TwoCreatesOfOneResi(t *testing.T) {
	h := san_race.New(t, raceRestockTables...)
	svc := inventory_v1.NewService(h.DB(), nil, nil, nil, nil, nil, nil, nil, nil, nil)

	for round := range raceRefRounds {
		ids := make([]uint64, 2)

		res := h.Race(t, 2, func(i int) error {
			created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
				TeamId: raceRestockTeam, WarehouseId: raceRestockWarehouse, Items: raceRestockItems(),
				Receipt: "JNT-RACE-" + strconv.Itoa(round),
			}))
			if err != nil {
				return err
			}

			ids[i] = created.Msg.GetRequest().GetId()

			return nil
		})

		raceRefOneWins(t, round, res, ids, inventoryv1.RestockReference_RESTOCK_REFERENCE_RECEIPT)
	}
}

// An ONGOING EDIT taking a resi races a create of the same resi: one of them holds it, the other is refused.
func TestRace_RestockReference_AnEditAndACreateOfOneResi(t *testing.T) {
	h := san_race.New(t, raceRestockTables...)
	svc := inventory_v1.NewService(h.DB(), nil, nil, nil, nil, nil, nil, nil, nil, nil)

	for round := range raceRefRounds {
		edited := raceRestockSeed(t, h.DB())
		resi := "SCP-RACE-" + strconv.Itoa(round)
		ids := []uint64{edited, 0}

		res := h.Race(t, 2, func(i int) error {
			if i == 0 {
				_, err := svc.RestockRequestUpdate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
					TeamId: raceRestockTeam, RequestId: edited, WarehouseId: raceRestockWarehouse, FinanceAccountId: 41,
					Receipt: resi, Items: raceRestockItems(),
				}))

				return err
			}

			created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
				TeamId: raceRestockTeam, WarehouseId: raceRestockWarehouse, Items: raceRestockItems(), Receipt: resi,
			}))
			if err != nil {
				return err
			}

			ids[1] = created.Msg.GetRequest().GetId()

			return nil
		})

		raceRefOneWins(t, round, res, ids, inventoryv1.RestockReference_RESTOCK_REFERENCE_RECEIPT)
	}
}

// Two ONGOING EDITS trading their resis at the same instant. Each holds its own restock FOR UPDATE and its new value
// waits on the other's OLD one — a deadlock Postgres breaks by aborting one. In either serial order the other restock
// still holds the value, so BOTH are refused, AlreadyExists naming the other — never an internal error — and neither
// restock changes.
func TestRace_RestockReference_TwoEditsTradingResis(t *testing.T) {
	h := san_race.New(t, raceRestockTables...)
	svc := inventory_v1.NewService(h.DB(), nil, nil, nil, nil, nil, nil, nil, nil, nil)

	edit := func(id uint64, resi string) error {
		_, err := svc.RestockRequestUpdate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
			TeamId: raceRestockTeam, RequestId: id, WarehouseId: raceRestockWarehouse, FinanceAccountId: 41,
			Receipt: resi, Items: raceRestockItems(),
		}))

		return err
	}

	deadlocked := 0

	for round := range raceRefRounds {
		a, b := raceRestockSeed(t, h.DB()), raceRestockSeed(t, h.DB())
		resiA, resiB := "SWAP-A-"+strconv.Itoa(round), "SWAP-B-"+strconv.Itoa(round)

		for _, set := range []struct {
			id   uint64
			resi string
		}{{a, resiA}, {b, resiB}} {
			err := edit(set.id, set.resi)
			if err != nil {
				t.Fatalf("round %d: give restock %d its resi: %v", round, set.id, err)
			}
		}

		ids := []uint64{a, b}
		want := []string{resiB, resiA}

		res := h.Race(t, 2, func(i int) error {
			return edit(ids[i], want[i])
		})

		slow := false

		for i, o := range res.Outcomes {
			if connect.CodeOf(o.Err) != connect.CodeAlreadyExists {
				res.Report(t)
				t.Fatalf("round %d edit %d: %v — want AlreadyExists, both edits are refused", round, i, o.Err)
			}

			if got := raceRefHolder(o.Err, inventoryv1.RestockReference_RESTOCK_REFERENCE_RECEIPT); got != ids[1-i] {
				t.Fatalf("round %d edit %d names restock %d, want the other, %d", round, i, got, ids[1-i])
			}

			slow = slow || o.Wall > 500*time.Millisecond
		}

		if slow {
			deadlocked++
		}

		var stored []string

		h.DB().Raw(`SELECT receipt FROM restocks WHERE id IN (?, ?) ORDER BY id`, a, b).Scan(&stored)
		if len(stored) != 2 || stored[0] != resiA || stored[1] != resiB {
			t.Fatalf("round %d: the restocks hold %v, want unchanged [%s %s]", round, stored, resiA, resiB)
		}
	}

	// Postgres' deadlock_timeout (1 s) is how long the aborted one waited — a slow outcome is a deadlock broken.
	t.Logf("%d of %d rounds went through a deadlock", deadlocked, raceRefRounds)
}
