//go:build raceaudit

// Concurrency audit for OrderStatusChange and TeamReturnConfigurationSet (the audit-sql skill), and the status
// move against OrderCancel — the two writers of an order's status.
//
//	go test -tags raceaudit -run 'TestRace_OrderStatusChange|TestInterleave_OrderStatusChange|TestRace_TeamReturnConfigurationSet|TestInterleave_TeamReturnConfigurationSet' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// The race's selling team — its own, so cleaning it can never touch a row another test owns.
const raceOrderTeam uint64 = 7_700_002

func orderRaceHarness(t *testing.T) *san_race.Harness {
	t.Helper()

	h := san_race.New(t)

	clean := func() {
		// order_items and order_events go by ON DELETE CASCADE; shops do not, so the orders go first.
		for _, sql := range []string{
			`DELETE FROM orders WHERE team_id = ?`,
			`DELETE FROM shops WHERE team_id = ?`,
			`DELETE FROM team_return_configurations WHERE team_id = ?`,
		} {
			err := h.DB().Exec(sql, raceOrderTeam).Error
			if err != nil {
				t.Errorf("cleaning the race team: %v", err)
			}
		}
	}

	clean()
	t.Cleanup(clean)

	return h
}

// raceOrder places an order on the race team's shop, shipping from testWarehouse — committed.
func raceOrder(t *testing.T, svc *selling_v1.Service, shopID uint64) uint64 {
	t.Helper()

	return placeOrder(t, svc, raceOrderTeam, shopID)
}

func raceMove(svc *selling_v1.Service, teamID, orderID uint64, to sellingv1.OrderStatus) (*sellingv1.OrderStatusChangeResult, error) {
	res, err := svc.OrderStatusChange(context.Background(), connect.NewRequest(&sellingv1.OrderStatusChangeRequest{
		TeamId: teamID, OrderIds: []uint64{orderID}, To: to,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetResults()[0], nil
}

// eventCount is how many history rows of `kind` the order has.
func eventCount(t *testing.T, db *gorm.DB, orderID uint64, kind string) int64 {
	t.Helper()

	var n int64

	err := db.Raw(`SELECT count(*) FROM order_events WHERE order_id = ? AND kind = ?`, orderID, kind).Scan(&n).Error
	if err != nil {
		t.Fatalf("count %s events of %d: %v", kind, orderID, err)
	}

	return n
}

func rawStatus(t *testing.T, db *gorm.DB, orderID uint64) string {
	t.Helper()

	var status string

	err := db.Raw(`SELECT status FROM orders WHERE id = ?`, orderID).Scan(&status).Error
	if err != nil {
		t.Fatalf("status of %d: %v", orderID, err)
	}

	return status
}

// ── OrderStatusChange ─────────────────────────────────────────────────────────────────────────────

// Eight crew scan the same parcel at once (processed → picked): exactly one moves it, the other seven are
// told it is already picked, and the history has ONE picked row — never the move written twice.
func TestRace_OrderStatusChange_SameMoveAtOnce(t *testing.T) {
	h := orderRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Status", "RS-1", "shopee")

	const n = 8

	for round := range 10 {
		orderID := raceOrder(t, svc, shopID)
		moveOrder(t, svc, testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "")

		results := make([]*sellingv1.OrderStatusChangeResult, n)

		res := h.Race(t, n, func(i int) error {
			got, err := raceMove(svc, testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_PICKED)
			results[i] = got

			return err
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d calls FAILED — a batch move answers per order, it never errors", round, res.Failed())
		}

		moved := 0

		for i, r := range results {
			switch {
			case r.GetMoved():
				moved++
			case !strings.Contains(r.GetRefusedReason(), "already picked"):
				t.Fatalf("round %d: caller %d refused for %q — want \"already picked\"", round, i, r.GetRefusedReason())
			}
		}

		if moved != 1 {
			t.Fatalf("round %d: %d callers moved the order — want exactly one", round, moved)
		}

		if got := eventCount(t, h.DB(), orderID, "picked"); got != 1 {
			t.Fatalf("round %d: %d picked rows on the history — want one", round, got)
		}
	}
}

// THE PROOF THE ORDER'S ROW LOCK HOLDS, and that B RE-READS after it. A has moved the order to picked and not
// committed; B's same move must wait on the row, then see A's picked and be refused — not move it again from
// the processed it would have read before the lock.
func TestInterleave_OrderStatusChange_SecondWaitsAndReReads(t *testing.T) {
	h := orderRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Status", "RS-2", "shopee")

	orderID := raceOrder(t, svc, shopID)
	moveOrder(t, svc, testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "")

	var a, b *sellingv1.OrderStatusChangeResult

	pick := func(dst **sellingv1.OrderStatusChangeResult) func(tx *gorm.DB) error {
		return func(tx *gorm.DB) error {
			got, err := raceMove(newService(t, tx), testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_PICKED)
			*dst = got

			return err
		}
	}

	const second = "B picks the same order"

	sched := h.Interleave(t,
		san_race.Do("A", "A picks the order — FOR UPDATE holds its row", pick(&a)),
		san_race.Block("B", second, pick(&b)),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	step := sched.Get(second)
	if !step.Blocked || !step.Released {
		t.Fatalf("B did not wait on the order's row (blocked=%v released=%v)", step.Blocked, step.Released)
	}

	if !a.GetMoved() {
		t.Fatalf("A was refused: %s", a.GetRefusedReason())
	}

	if b.GetMoved() || !strings.Contains(b.GetRefusedReason(), "already picked") {
		t.Fatalf("B after the wait: moved=%v reason=%q — it acted on the status it read BEFORE the lock",
			b.GetMoved(), b.GetRefusedReason())
	}

	if got := eventCount(t, h.DB(), orderID, "picked"); got != 1 {
		t.Fatalf("%d picked rows on the history — want one", got)
	}
}

// The warehouse confirms a pending order in the same second the selling team cancels it. ONE of them wins, and
// the other is refused by the state the first left: never a cancelled order the warehouse goes on to pick, and
// never a processed order whose stock was put back.
func TestRace_OrderStatusChange_ConfirmAgainstCancel(t *testing.T) {
	h := orderRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Status", "RS-3", "shopee")

	wins := map[string]int{}

	for round := range 20 {
		orderID := raceOrder(t, svc, shopID)

		var confirm *sellingv1.OrderStatusChangeResult

		var cancelErr error

		res := h.Race(t, 2, func(i int) error {
			if i == 0 {
				got, err := raceMove(svc, testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED)
				confirm = got

				return err
			}

			_, cancelErr = svc.OrderCancel(context.Background(), connect.NewRequest(&sellingv1.OrderCancelRequest{
				TeamId: raceOrderTeam, OrderId: orderID,
			}))

			return nil // the cancel's refusal is the expected outcome half the time — judged below
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: the confirm call failed outright", round)
		}

		status := rawStatus(t, h.DB(), orderID)
		processed := eventCount(t, h.DB(), orderID, "processed")
		cancelled := eventCount(t, h.DB(), orderID, "cancel")

		switch status {
		case "processed":
			if !confirm.GetMoved() || connect.CodeOf(cancelErr) != connect.CodeFailedPrecondition || cancelled != 0 {
				t.Fatalf("round %d: processed, but confirm=%v cancel=%v cancel rows=%d", round, confirm.GetMoved(), cancelErr, cancelled)
			}
		case "cancel":
			if confirm.GetMoved() || cancelErr != nil || processed != 0 {
				t.Fatalf("round %d: cancelled, but confirm=%v cancel=%v processed rows=%d", round, confirm.GetMoved(), cancelErr, processed)
			}
		default:
			t.Fatalf("round %d: the order ended %q", round, status)
		}

		wins[status]++
	}

	t.Logf("winners over 20 rounds: %v", wins)
}

// Two batches over the same two orders in OPPOSITE orders. Each batch is one transaction holding both rows, so
// only the lock's ID ORDER (never the scan order) keeps them from deadlocking: each order moves exactly once
// (a-batch-move-saves-in-one-transaction).
func TestRace_OrderStatusChange_OppositeBatchOrders(t *testing.T) {
	h := orderRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Status", "RS-4", "shopee")

	for round := range 20 {
		first := raceOrder(t, svc, shopID)
		second := raceOrder(t, svc, shopID)

		for _, id := range []uint64{first, second} {
			moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "")
		}

		batches := [][]uint64{{first, second}, {second, first}}

		res := h.Race(t, 2, func(i int) error {
			_, err := svc.OrderStatusChange(context.Background(), connect.NewRequest(&sellingv1.OrderStatusChangeRequest{
				TeamId: testWarehouse, OrderIds: batches[i], To: sellingv1.OrderStatus_ORDER_STATUS_PICKED,
			}))

			return err
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Count(san_race.Deadlock) > 0 || res.Failed() > 0 {
			t.Fatalf("round %d: deadlocks=%d failed=%d", round, res.Count(san_race.Deadlock), res.Failed())
		}

		for _, id := range []uint64{first, second} {
			if got := eventCount(t, h.DB(), id, "picked"); got != 1 {
				t.Fatalf("round %d: order %d has %d picked rows — want one", round, id, got)
			}
		}
	}
}

// ── TeamReturnConfigurationSet ────────────────────────────────────────────────────────────────────

func raceSetReturn(svc *selling_v1.Service, warehouseID uint64) error {
	_, err := svc.TeamReturnConfigurationSet(context.Background(), connect.NewRequest(
		&sellingv1.TeamReturnConfigurationSetRequest{TeamId: raceOrderTeam, WarehouseId: warehouseID},
	))

	return err
}

func returnRows(t *testing.T, db *gorm.DB) (rows int64, warehouse uint64) {
	t.Helper()

	err := db.Raw(`SELECT count(*) FROM team_return_configurations WHERE team_id = ?`, raceOrderTeam).Scan(&rows).Error
	if err == nil {
		err = db.Raw(`SELECT COALESCE(MAX(warehouse_id), 0) FROM team_return_configurations WHERE team_id = ?`, raceOrderTeam).
			Scan(&warehouse).
			Error
	}

	if err != nil {
		t.Fatalf("read the race team's return configuration: %v", err)
	}

	return rows, warehouse
}

// Eight managers set the team's FIRST return warehouse at once, each a different one. The ON CONFLICT on the
// unique team index turns the losers into updates: no error, ONE row, holding one of the eight.
func TestRace_TeamReturnConfigurationSet_FirstSetAtOnce(t *testing.T) {
	h := orderRaceHarness(t)
	svc := newService(t, h.DB())

	const n = 8

	for round := range 10 {
		err := h.DB().Exec(`DELETE FROM team_return_configurations WHERE team_id = ?`, raceOrderTeam).Error
		if err != nil {
			t.Fatalf("reset: %v", err)
		}

		res := h.Race(t, n, func(i int) error {
			return raceSetReturn(svc, uint64(41+i))
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d sets failed (unique violations: %d)", round, res.Failed(), res.Count(san_race.UniqueViolation))
		}

		rows, warehouse := returnRows(t, h.DB())
		if rows != 1 || warehouse < 41 || warehouse >= 41+n {
			t.Fatalf("round %d: %d rows holding warehouse %d — want one row, one of the eight", round, rows, warehouse)
		}
	}
}

// THE PROOF THE UPSERT SERIALISES on the very first set — the case no row lock can cover. A has inserted the
// team's row and not committed; B's insert must WAIT on A's uncommitted key, then take the conflict path and
// update it — not fail with a unique violation, and not leave two rows.
func TestInterleave_TeamReturnConfigurationSet_FirstSetWaits(t *testing.T) {
	h := orderRaceHarness(t)

	set := func(warehouseID uint64) func(tx *gorm.DB) error {
		return func(tx *gorm.DB) error {
			return raceSetReturn(newService(t, tx), warehouseID)
		}
	}

	const second = "B sets warehouse 58"

	sched := h.Interleave(t,
		san_race.Do("A", "A inserts the team's row with warehouse 41", set(41)),
		san_race.Block("B", second, set(58)),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	step := sched.Get(second)
	if !step.Blocked || !step.Released || step.Err != nil {
		t.Fatalf("B: blocked=%v released=%v err=%v — want it held on A's key, then updating", step.Blocked, step.Released, step.Err)
	}

	rows, warehouse := returnRows(t, h.DB())
	if rows != 1 || warehouse != 58 {
		t.Fatalf("%d rows holding warehouse %d — want one row holding the later 58", rows, warehouse)
	}
}

// And a replace: the row exists, A updates it and has not committed, B's update waits on the row lock and
// lands after — the later save wins, on the one row.
func TestInterleave_TeamReturnConfigurationSet_ReplaceWaits(t *testing.T) {
	h := orderRaceHarness(t)

	err := raceSetReturn(newService(t, h.DB()), 40)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	set := func(warehouseID uint64) func(tx *gorm.DB) error {
		return func(tx *gorm.DB) error {
			return raceSetReturn(newService(t, tx), warehouseID)
		}
	}

	const second = "B replaces it with 58"

	sched := h.Interleave(t,
		san_race.Do("A", "A replaces 40 with 41", set(41)),
		san_race.Block("B", second, set(58)),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	step := sched.Get(second)
	if !step.Blocked || !step.Released || step.Err != nil {
		t.Fatalf("B: blocked=%v released=%v err=%v", step.Blocked, step.Released, step.Err)
	}

	rows, warehouse := returnRows(t, h.DB())
	if rows != 1 || warehouse != 58 {
		t.Fatalf("%d rows holding warehouse %d — want one row holding 58", rows, warehouse)
	}
}
