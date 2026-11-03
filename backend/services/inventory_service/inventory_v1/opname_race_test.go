//go:build raceaudit

// Concurrency audit for the stock count's writes (the audit-sql skill): OpnameSessionCreate, OpnameRowCount,
// OpnameRowMarkCounted, OpnameRowSendBack, OpnameSessionCancel, OpnameSessionFinalize — two at once must never open two
// counts, take a third count, post a finalize twice, or deadlock against an order's take. Build-tagged: san_race COMMITS.
//
//	go test -tags raceaudit -run "TestRace_Opname|TestInterleave_Opname" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

func raceStaff(id uint64) context.Context {
	return ctxAs(id, raceWarehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF)
}

func raceAdmin(id uint64) context.Context {
	return ctxAs(id, raceWarehouse, role_basev1.Role_ROLE_WAREHOUSE_ADMIN)
}

// raceCount plans a product count of raceProductA (two racks of 10, two batches of 10) and returns it with its rows.
func raceCount(t *testing.T, svc *inventory_v1.Service) (*inventoryv1.OpnameSession, []*inventoryv1.OpnameRow) {
	t.Helper()

	res, err := svc.OpnameSessionCreate(raceAdmin(43), connect.NewRequest(&inventoryv1.OpnameSessionCreateRequest{
		TeamId: raceWarehouse, Plan: inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, FilterProductId: raceProductA,
	}))
	if err != nil {
		t.Fatalf("plan: %v", err)
	}

	s := res.Msg.GetSession()

	list, err := svc.OpnameRowList(raceAdmin(43), connect.NewRequest(&inventoryv1.OpnameRowListRequest{
		TeamId: raceWarehouse, Filter: &inventoryv1.OpnameRowListFilter{SessionId: s.GetId()}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("rows: %v", err)
	}

	var rows []*inventoryv1.OpnameRow
	for _, id := range list.Msg.GetIds() {
		rows = append(rows, list.Msg.GetItems()[0].GetRow().GetMapData()[id])
	}

	return s, rows
}

// countAndMark counts a row as staff member 41 and closes it with every reason.
func countAndMark(t *testing.T, svc *inventory_v1.Service, rowID uint64, n, broken int64) {
	t.Helper()

	_, err := svc.OpnameRowCount(raceStaff(41), connect.NewRequest(&inventoryv1.OpnameRowCountRequest{
		TeamId: raceWarehouse, RowId: rowID, Count: n,
	}))
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	_, err = svc.OpnameRowMarkCounted(raceStaff(41), connect.NewRequest(&inventoryv1.OpnameRowMarkCountedRequest{
		TeamId: raceWarehouse, RowId: rowID, BrokenCount: broken, BrokenNote: "torn", LostNote: "gone", SurplusNote: "behind",
	}))
	if err != nil {
		t.Fatalf("mark: %v", err)
	}
}

// ONE ACTIVE COUNT PER WAREHOUSE, by the database: eight admins plan at once — one count opens, seven are refused, and
// the shelf rows are snapshotted once.
func TestRace_OpnameSessionCreate_OneActiveCount(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())

	res := h.Race(t, 8, func(int) error {
		_, err := svc.OpnameSessionCreate(raceAdmin(43), connect.NewRequest(&inventoryv1.OpnameSessionCreateRequest{
			TeamId: raceWarehouse, Plan: inventoryv1.OpnamePlan_OPNAME_PLAN_ALL,
		}))
		if connect.CodeOf(err) == connect.CodeFailedPrecondition {
			return nil
		}

		return err
	})
	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d planners failed for a reason other than the active count", res.Failed())
	}

	var sessions, rows int64
	h.DB().Raw(`SELECT COUNT(*) FROM opname_sessions WHERE warehouse_id = ?`, raceWarehouse).Scan(&sessions)
	h.DB().Raw(`SELECT COUNT(*) FROM opname_session_snapshots WHERE warehouse_id = ?`, raceWarehouse).Scan(&rows)

	if sessions != 1 || rows != 2 {
		t.Fatalf("%d counts with %d rows, want 1 with 2", sessions, rows)
	}
}

// THE ONE RECOUNT: eight phones submit the same row at once — they queue on the row, the first is the blind count, the
// second the recount, the other six are refused. Never two recounts, never a lost write.
func TestRace_OpnameRowCount_OneBlindOneRecount(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())
	_, rows := raceCount(t, svc)

	var c codes

	res := h.Race(t, 8, func(i int) error {
		_, err := svc.OpnameRowCount(raceStaff(uint64(50+i)), connect.NewRequest(&inventoryv1.OpnameRowCountRequest{
			TeamId: raceWarehouse, RowId: rows[0].GetId(), Count: int64(i),
		}))
		c.add(err)

		if connect.CodeOf(err) == connect.CodeFailedPrecondition {
			return nil
		}

		return err
	})
	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d counters failed for a reason other than the used recount", res.Failed())
	}

	if ok := c.got[0]; ok != 2 {
		t.Fatalf("%d counts went in, want exactly 2 — the blind one and the recount", ok)
	}

	var recounted bool
	h.DB().Raw(`SELECT recounted FROM opname_session_snapshots WHERE id = ?`, rows[0].GetId()).Scan(&recounted)
	if !recounted {
		t.Fatalf("the row does not record its recount")
	}
}

// FINALIZE ONCE: four admins finalize at the same second while one cancels — exactly one of them wins, and whatever won,
// the shortage is posted at most once.
func TestRace_OpnameSessionFinalize_PostsOnce(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())
	s, rows := raceCount(t, svc)

	countAndMark(t, svc, rows[0].GetId(), 8, 1)
	countAndMark(t, svc, rows[1].GetId(), 10, 0)

	var c codes

	res := h.Race(t, 5, func(i int) error {
		var err error

		if i == 4 {
			_, err = svc.OpnameSessionCancel(raceAdmin(43), connect.NewRequest(&inventoryv1.OpnameSessionCancelRequest{
				TeamId: raceWarehouse, SessionId: s.GetId(),
			}))
		} else {
			_, err = svc.OpnameSessionFinalize(raceAdmin(uint64(60+i)), connect.NewRequest(&inventoryv1.OpnameSessionFinalizeRequest{
				TeamId: raceWarehouse, SessionId: s.GetId(),
			}))
		}

		c.add(err)

		if connect.CodeOf(err) == connect.CodeFailedPrecondition {
			return nil
		}

		return err
	})
	res.Report(t)

	if res.Failed() != 0 || res.Count(san_race.Deadlock) != 0 {
		t.Fatalf("%d callers failed beyond the expected refusal", res.Failed())
	}

	if ok := c.got[0]; ok != 1 {
		t.Fatalf("%d of finalize/cancel succeeded, want exactly 1", ok)
	}

	var problems, listed int64
	h.DB().Raw(`SELECT COUNT(*) FROM inventory_transactions WHERE tx_type = 'problem'`).Scan(&problems)
	h.DB().Raw(`SELECT COUNT(*) FROM opname_session_final_transactions WHERE opname_session_id = ?`, s.GetId()).Scan(&listed)

	if problems > 1 || listed > 1 {
		t.Fatalf("%d problem transactions, %d listed — the count posted twice", problems, listed)
	}

	if b, r := stockOf(t, h.DB(), raceProductA); b != r {
		t.Fatalf("batches %d, racks %d — the ledgers drifted", b, r)
	}
}

// A FINALIZE RACING ORDER TAKES on the same product: the finalize locks the register, the batches, then the racks — the
// order the take keeps — so nothing deadlocks, the shortage is posted once, and both ledgers still agree.
func TestRace_OpnameSessionFinalize_RacingTakes(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())
	s, rows := raceCount(t, svc)

	countAndMark(t, svc, rows[0].GetId(), 9, 0)
	countAndMark(t, svc, rows[1].GetId(), 10, 0)

	res := h.Race(t, 9, func(i int) error {
		if i == 0 {
			_, err := svc.OpnameSessionFinalize(raceAdmin(43), connect.NewRequest(&inventoryv1.OpnameSessionFinalizeRequest{
				TeamId: raceWarehouse, SessionId: s.GetId(),
			}))

			return err
		}

		return raceTake(svc, fmt.Sprintf("K-%d", i), &inventoryv1.OrderTransactionLine{ProductId: raceProductA, Quantity: 1})
	})
	res.Report(t)

	if res.Count(san_race.Deadlock) != 0 || res.Failed() != 0 {
		t.Fatalf("%d callers failed (%d deadlocked)", res.Failed(), res.Count(san_race.Deadlock))
	}

	if b, r := stockOf(t, h.DB(), raceProductA); b != 20-1-8 || r != b {
		t.Fatalf("batches %d, racks %d — want 11 each: 20, one lost, eight sold", b, r)
	}
}

// THE LOCK IS READ AFTER THE SHELF ROW IS LOCKED, in a statement of its own — proved both ways round.
//
//  1. A mover holds the shelf row; a count planned now WAITS for it (FOR SHARE), and snapshots the book the move left.
//  2. A count holds the shelf row (its snapshot uncommitted); a mover waits for it, and once the count commits, its NEXT
//     statement reads the open row and refuses — the check a subquery in the locking SELECT would have missed.
func TestInterleave_Opname_TheCountLockHoldsBothWays(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)

	var shelfID, rackID uint64
	h.DB().Raw(`SELECT id, placement_id FROM product_placements WHERE product_id = ? ORDER BY id LIMIT 1`, raceProductA).
		Row().Scan(&shelfID, &rackID)

	key := inventory_ledgers.RackKey{ProductID: raceProductA, PlacementID: rackID}

	plan := func(tx *gorm.DB) error {
		var session uint64

		err := tx.Raw(`INSERT INTO opname_sessions (warehouse_id, plan, created_by_id) VALUES (?, 'product', 43) RETURNING id`,
			raceWarehouse).Scan(&session).Error
		if err != nil {
			return err
		}

		return tx.Exec(`
			INSERT INTO opname_session_snapshots (warehouse_id, team_id, product_id, placement_id, opname_session_id, system_stock_count)
			SELECT pp.warehouse_id, pp.team_id, pp.product_id, pp.placement_id, ?, pp.stock_count
			FROM (SELECT * FROM product_placements WHERE id = ? FOR SHARE) AS pp`, session, shelfID).Error
	}

	lockShelf := func(tx *gorm.DB) error {
		return tx.Exec(`SELECT id FROM product_placements WHERE id = ? FOR UPDATE`, shelfID).Error
	}

	moveOff := func(tx *gorm.DB) error {
		return tx.Exec(`UPDATE product_placements SET stock_count = stock_count - 1 WHERE id = ?`, shelfID).Error
	}

	// 1 — the mover first.
	first := h.Interleave(t,
		san_race.Do("A", "mover locks the shelf row", lockShelf),
		san_race.Do("A", "mover takes one off", moveOff),
		san_race.Block("B", "the count snapshots the row", plan),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	first.Report(t)

	if r := first.Get("the count snapshots the row"); !r.Blocked || r.Err != nil {
		t.Fatalf("the count did not wait for the mover: %+v", r)
	}

	var book int64
	h.DB().Raw(`SELECT system_stock_count FROM opname_session_snapshots WHERE product_id = ? AND placement_id = ?`,
		raceProductA, rackID).Scan(&book)
	if book != 9 {
		t.Fatalf("the count copied a book of %d, want 9 — the move it waited for", book)
	}

	h.DB().Exec(`DELETE FROM opname_session_snapshots`)
	h.DB().Exec(`DELETE FROM opname_sessions`)

	// 2 — the count first.
	second := h.Interleave(t,
		san_race.Do("B", "the count snapshots the row", plan),
		san_race.Block("A", "mover locks the shelf row", lockShelf),
		san_race.Commit("B"),
		san_race.Do("A", "mover reads the count lock", func(tx *gorm.DB) error {
			return inventory_ledgers.RefuseCounted(tx, []inventory_ledgers.RackKey{key})
		}),
		san_race.Rollback("A"),
	)
	second.Report(t)

	if r := second.Get("mover locks the shelf row"); !r.Blocked {
		t.Fatalf("the mover did not wait for the count: %+v", r)
	}

	if r := second.Get("mover reads the count lock"); r.Err == nil {
		t.Fatalf("the mover read no lock after the count committed — it would have moved counted units")
	}
}
