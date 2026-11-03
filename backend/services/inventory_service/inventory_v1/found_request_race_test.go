//go:build raceaudit

// Concurrency audit for found stock (the audit-sql skill): FoundRequestCreate, FoundRequestApprove, FoundRequestReject,
// and the settle a count's finalize runs (a-count-settles-the-found-it-counted). Two people at one second must never post
// a found twice — two approvals, an approval and a withdrawal, an approval and a count that counts the same units — nor
// deadlock against an order's take. Build-tagged: san_race COMMITS.
//
//	go test -tags raceaudit -p 1 -run "TestRace_FoundRequest|TestInterleave_FoundRequest" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"fmt"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// raceReport sends a found for approval as `by`.
func raceReport(t *testing.T, svc *inventory_v1.Service, by uint64, rack uint64, n int64) uint64 {
	t.Helper()

	res, err := svc.FoundRequestCreate(raceStaff(by), connect.NewRequest(&inventoryv1.FoundRequestCreateRequest{
		TeamId: raceWarehouse, ProductId: raceProductA, RackId: rack, Quantity: n, Note: "behind the cartons",
	}))
	if err != nil {
		t.Fatalf("report: %v", err)
	}

	return res.Msg.GetFoundRequest().GetId()
}

func raceApprove(svc *inventory_v1.Service, by, id uint64) error {
	_, err := svc.FoundRequestApprove(raceAdmin(by), connect.NewRequest(&inventoryv1.FoundRequestApproveRequest{
		TeamId: raceWarehouse, FoundRequestId: id,
	}))

	return err
}

// foundPosted is how many units `found` transactions posted for the product, and how many such transactions there are.
func foundPosted(t *testing.T, db *gorm.DB) (units, transactions int64) {
	t.Helper()

	db.Raw(`SELECT COALESCE(SUM(i.quantity), 0) FROM inventory_transaction_items i
		JOIN inventory_transactions x ON x.id = i.transaction_id
		WHERE x.tx_type = 'found' AND i.product_id = ?`, raceProductA).Scan(&units)
	db.Raw(`SELECT COUNT(*) FROM inventory_transactions WHERE tx_type = 'found'`).Scan(&transactions)

	return units, transactions
}

// wipeLedgers empties every table the harness owns, children first — a fresh warehouse for the next round.
func wipeLedgers(t *testing.T, db *gorm.DB) {
	t.Helper()

	for _, table := range ledgerTables {
		err := db.Exec(`DELETE FROM ` + table).Error
		if err != nil {
			t.Fatalf("wipe %s: %v", table, err)
		}
	}
}

// APPROVED ONCE: eight Owners and Admins approve one request at the same second. They queue on the request row; the first
// posts, the other seven find it no longer waiting. One `found` transaction, both ledgers equal.
func TestRace_FoundRequestApprove_PostsOnce(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())
	id := raceReport(t, svc, 44, raceRack(t, h.DB(), "rak-a"), 2)

	var c codes

	res := h.Race(t, 8, func(i int) error {
		err := raceApprove(svc, uint64(60+i), id)
		c.add(err)

		if connect.CodeOf(err) == connect.CodeFailedPrecondition {
			return nil
		}

		return err
	})
	res.Report(t)

	if res.Failed() != 0 || res.Count(san_race.Deadlock) != 0 {
		t.Fatalf("%d approvers failed beyond the expected refusal", res.Failed())
	}

	if c.got[0] != 1 {
		t.Fatalf("%d approvals went through, want exactly 1", c.got[0])
	}

	if units, txs := foundPosted(t, h.DB()); units != 2 || txs != 1 {
		t.Fatalf("%d found transaction(s) posting %d units, want 1 posting 2", txs, units)
	}

	if b, r := stockOf(t, h.DB(), raceProductA); b != 22 || r != 22 {
		t.Fatalf("batches %d, racks %d — want 22 each", b, r)
	}
}

// AN APPROVAL RACING THE REPORTER'S WITHDRAWAL (the-reporter-may-withdraw-their-found): exactly one of them decides the
// request, ten rounds over. Approved, its units posted once; withdrawn, nothing posted.
func TestRace_FoundRequestApprove_RacingAWithdraw(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())
	rack := raceRack(t, h.DB(), "rak-a")

	approved, withdrawn := int64(0), int64(0)

	for round := range 10 {
		id := raceReport(t, svc, 44, rack, 1)

		res := h.Race(t, 2, func(i int) error {
			if i == 0 {
				return raceApprove(svc, 45, id)
			}

			_, err := svc.FoundRequestReject(raceStaff(44), connect.NewRequest(&inventoryv1.FoundRequestRejectRequest{
				TeamId: raceWarehouse, FoundRequestId: id, Reason: "my mistake",
			}))

			return err
		})

		won := 0
		for _, o := range res.Outcomes {
			switch {
			case o.Err == nil:
				won++
			case connect.CodeOf(o.Err) != connect.CodeFailedPrecondition:
				res.Report(t)
				t.Fatalf("round %d, caller %d: %v", round, o.I, o.Err)
			}
		}

		if won != 1 {
			res.Report(t)
			t.Fatalf("round %d: %d deciders won, want exactly 1", round, won)
		}

		if res.Outcomes[0].Err == nil {
			approved++
		} else {
			withdrawn++
		}
	}

	if units, txs := foundPosted(t, h.DB()); units != approved || txs != approved {
		t.Fatalf("%d found transaction(s) posting %d units, want %d — one per approval", txs, units, approved)
	}

	if b, r := stockOf(t, h.DB(), raceProductA); b != 20+approved || r != b {
		t.Fatalf("batches %d, racks %d — want %d each", b, r, 20+approved)
	}

	t.Logf("10 rounds: %d approved first, %d withdrawn first", approved, withdrawn)
}

// AN APPROVAL RACING ORDER TAKES on the same product: the approval locks the register, the batches, then the rack row —
// the order the take keeps — so nothing deadlocks, every take of the plentiful shelf goes through, and both ledgers end
// equal at 20 + 2 found − 8 sold.
func TestRace_FoundRequestApprove_RacingTakes(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())
	id := raceReport(t, svc, 44, raceRack(t, h.DB(), "rak-a"), 2)

	res := h.Race(t, 9, func(i int) error {
		if i == 0 {
			return raceApprove(svc, 45, id)
		}

		return raceTake(svc, fmt.Sprintf("K-%d", i), &inventoryv1.OrderTransactionLine{ProductId: raceProductA, Quantity: 1})
	})
	res.Report(t)

	if res.Failed() != 0 || res.Count(san_race.Deadlock) != 0 {
		t.Fatalf("%d callers failed", res.Failed())
	}

	if b, r := stockOf(t, h.DB(), raceProductA); b != 14 || r != 14 {
		t.Fatalf("batches %d, racks %d — want 14 each: 20, 2 found, 8 sold", b, r)
	}
}

// AN APPROVAL RACING A COUNT OF THE SAME RACK (a-count-settles-the-found-it-counted): three Kaos found on Rak A wait; an
// Admin approves them at the second a count of the product is planned. Then the counters count what is really on the
// shelf — Rak A 13, Rak B 10 — and the count is finalized. Whichever came first, the three post ONCE: approved first,
// the count copies a book that includes them and finds Rak A exact; planned first, the approval is refused naming the
// count, the count finds them as a surplus and its finalize settles the request. Never a deadlock. Ten raced rounds,
// then each order once on purpose, so both branches are seen whatever the scheduler does.
func TestRace_FoundRequestApprove_RacingACountPlanAndFinalize(t *testing.T) {
	h := san_race.New(t, ledgerTables...)

	approvedFirst, countedFirst := 0, 0

	type order int

	const (
		raced order = iota
		approveThenPlan
		planThenApprove
	)

	round := func(n int, mode order) {
		wipeLedgers(t, h.DB())
		seedLedgers(t, h.DB(), 10, raceProductA)
		svc := raceService(h.DB())
		rackA := raceRack(t, h.DB(), "rak-a")
		id := raceReport(t, svc, 44, rackA, 3)

		var (
			session    uint64
			approveErr error
			planErr    error
		)

		approve := func() error { return raceApprove(svc, 45, id) }
		plan := func() error {
			planned, err := svc.OpnameSessionCreate(raceAdmin(43), connect.NewRequest(&inventoryv1.OpnameSessionCreateRequest{
				TeamId: raceWarehouse, Plan: inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, FilterProductId: raceProductA,
			}))
			if err == nil {
				session = planned.Msg.GetSession().GetId()
			}

			return err
		}

		switch mode {
		case approveThenPlan:
			approveErr = approve()
			planErr = plan()
		case planThenApprove:
			planErr = plan()
			approveErr = approve()
		default:
			res := h.Race(t, 2, func(i int) error {
				if i == 0 {
					return approve()
				}

				return plan()
			})
			if res.Count(san_race.Deadlock) != 0 {
				res.Report(t)
				t.Fatalf("round %d: deadlock", n)
			}

			approveErr, planErr = res.Outcomes[0].Err, res.Outcomes[1].Err
		}

		if planErr != nil {
			t.Fatalf("round %d: the plan failed: %v", n, planErr)
		}

		if approveErr != nil && (connect.CodeOf(approveErr) != connect.CodeFailedPrecondition || !strings.Contains(approveErr.Error(), "count #")) {
			t.Fatalf("round %d: approve: %v, want approved or refused naming the count", n, approveErr)
		}

		// The counters count what is physically there: Rak A holds its 10 and the 3 found, Rak B its 10.
		list, err := svc.OpnameRowList(raceAdmin(43), connect.NewRequest(&inventoryv1.OpnameRowListRequest{
			TeamId: raceWarehouse, Filter: &inventoryv1.OpnameRowListFilter{SessionId: session}, Page: page1(),
		}))
		if err != nil {
			t.Fatalf("round %d: rows: %v", n, err)
		}

		for _, item := range list.Msg.GetItems() {
			for _, row := range item.GetRow().GetMapData() {
				physical := int64(10)
				if row.GetPlacementId() == rackA {
					physical = 13
				}

				countAndMark(t, svc, row.GetId(), physical, 0)
			}
		}

		_, err = svc.OpnameSessionFinalize(raceAdmin(43), connect.NewRequest(&inventoryv1.OpnameSessionFinalizeRequest{
			TeamId: raceWarehouse, SessionId: session,
		}))
		if err != nil {
			t.Fatalf("round %d: finalize: %v", n, err)
		}

		var status string
		h.DB().Raw(`SELECT status FROM found_requests WHERE id = ?`, id).Scan(&status)

		switch {
		case approveErr == nil && status == "approved":
			approvedFirst++
		case approveErr != nil && status == "settled":
			countedFirst++
		default:
			t.Fatalf("round %d: approve err %v, request %q — want approved, or refused and settled", n, approveErr, status)
		}

		if units, _ := foundPosted(t, h.DB()); units != 3 {
			t.Fatalf("round %d: found transactions posted %d units, want the 3 once", n, units)
		}

		if b, r := stockOf(t, h.DB(), raceProductA); b != 23 || r != 23 || rackCount(t, h.DB(), raceProductA, rackA) != 13 {
			t.Fatalf("round %d: batches %d, racks %d — want 23 each, Rak A 13", n, b, r)
		}
	}

	for n := range 10 {
		round(n, raced)
	}

	t.Logf("10 raced rounds: %d approved before the plan, %d counted first and settled", approvedFirst, countedFirst)

	round(10, approveThenPlan)
	round(11, planThenApprove)

	if approvedFirst == 0 || countedFirst == 0 {
		t.Fatalf("approved first %d, counted first %d — each order must have been seen", approvedFirst, countedFirst)
	}
}

// THE SETTLE WAITS FOR AN APPROVAL IN FLIGHT, AND RE-READS — the Postgres behaviour a-count-settles-the-found-it-counted
// leans on: an approval holds the request row and marks it approved; the finalize's settle (`SELECT … FOR UPDATE` of
// the waiting requests) blocks on it, and once the approval commits it re-checks `status = 'waiting'` and leaves the row
// alone — so a request is approved or settled, never both.
func TestInterleave_FoundRequest_TheSettleWaitsForAnApproval(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())
	id := raceReport(t, svc, 44, raceRack(t, h.DB(), "rak-a"), 1)

	var settled []uint64

	sched := h.Interleave(t,
		san_race.Do("A", "the approval locks the request", func(tx *gorm.DB) error {
			return tx.Exec(`SELECT id FROM found_requests WHERE id = ? FOR UPDATE`, id).Error
		}),
		san_race.Do("A", "the approval marks it approved", func(tx *gorm.DB) error {
			return tx.Exec(`UPDATE found_requests SET status = 'approved', decided_by_id = 45, decided_at = NOW(),
				transaction_id = (SELECT MIN(id) FROM inventory_transactions) WHERE id = ?`, id).Error
		}),
		san_race.Block("B", "the settle locks the waiting requests", func(tx *gorm.DB) error {
			return tx.Raw(`SELECT id FROM found_requests WHERE warehouse_id = ? AND status = 'waiting' ORDER BY id FOR UPDATE`,
				raceWarehouse).Scan(&settled).Error
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	if r := sched.Get("the settle locks the waiting requests"); !r.Blocked || r.Err != nil {
		t.Fatalf("the settle did not wait for the approval: %+v", r)
	}

	if len(settled) != 0 {
		t.Fatalf("the settle took request(s) %v the approval had already decided", settled)
	}
}
