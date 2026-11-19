//go:build raceaudit

// Concurrency audit for OrderShopUpdate (the audit-sql skill) — an-orders-shop-is-fixed-and-counted-on-the-day.
//
// The write is one transaction: the order read FOR UPDATE, the status gate, the old shop read, one UPDATE of the order,
// one note INSERT, one order_shop_changes INSERT. Without the lock two fixes at once would each name a stale old shop
// (a change chain the metrics could not follow), and a fix racing a status move could carry over a move it never saw —
// or miss one it did. Both are proved here, the second through the fold itself: whatever order the two commit in, the
// order's every metric ends counted once, under the shop it is in now.
//
//	go test -tags raceaudit -count=5 -run 'TestRace_OrderShopUpdate|TestRace_OrderMetricFold_ShopFix' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

func raceFix(svc *selling_v1.Service, orderID, shopID uint64) error {
	_, err := svc.OrderShopUpdate(asUser(7), connect.NewRequest(&sellingv1.OrderShopUpdateRequest{
		TeamId: raceOrderTeam, OrderId: orderID, ShopId: shopID,
	}))

	return err
}

// completedRaceOrder is a committed race order in shopID, its status set to completed — the state a fix starts from.
func completedRaceOrder(t *testing.T, h *san_race.Harness, svc *selling_v1.Service, shopID uint64) uint64 {
	t.Helper()

	orderID := raceOrder(t, svc, shopID)

	err := h.DB().Exec(`UPDATE orders SET status = 'completed' WHERE id = ?`, orderID).Error
	if err != nil {
		t.Fatalf("complete race order %d: %v", orderID, err)
	}

	return orderID
}

func cleanShopFixFold(t *testing.T, h *san_race.Harness) {
	t.Helper()

	clean := func() {
		err := h.DB().Exec(`DELETE FROM order_event_logs WHERE id IN (
		    SELECT 'order-placed:' || id FROM orders WHERE team_id = ?
		    UNION SELECT 'order-shop-changed:' || c.id FROM order_shop_changes c WHERE c.team_id = ?
		    UNION SELECT 'order-status-changed:' || l.id FROM order_timeline_logs l
		          JOIN orders o ON o.id = l.order_id WHERE o.team_id = ?)`,
			raceOrderTeam, raceOrderTeam, raceOrderTeam).Error
		if err != nil {
			t.Errorf("cleaning the fold's dedup: %v", err)
		}

		err = h.DB().Exec(`DELETE FROM order_daily_reports WHERE team_id = ?`, raceOrderTeam).Error
		if err != nil {
			t.Errorf("cleaning the fold's report: %v", err)
		}
	}

	clean()
	t.Cleanup(clean)
}

// TWO FIXES OF ONE ORDER AT ONCE, × 10 rounds — to two different shops. They queue on the order's row: both land, and
// the changes form ONE CHAIN — the second's old shop is the first's new — with the order in the last one's shop.
func TestRace_OrderShopUpdate_TwoFixesQueue(t *testing.T) {
	h := orderRaceHarness(t)
	svc := newService(t, h.DB())
	wrong := insertShop(t, h.DB(), raceOrderTeam, "Race Wrong", "RF-W", "shopee")
	shops := []uint64{
		insertShop(t, h.DB(), raceOrderTeam, "Race One", "RF-1", "shopee"),
		insertShop(t, h.DB(), raceOrderTeam, "Race Two", "RF-2", "shopee"),
	}

	for round := range 10 {
		orderID := completedRaceOrder(t, h, svc, wrong)

		res := h.Race(t, 2, func(i int) error {
			return raceFix(svc, orderID, shops[i])
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d fixes failed — deadlocks %d", round, res.Failed(), res.Count(san_race.Deadlock))
		}

		changes := shopChanges(t, h.DB(), orderID)
		if len(changes) != 2 || changes[0].FromShopID != wrong || changes[1].FromShopID != changes[0].ToShopID ||
			changes[0].ToShopID == changes[1].ToShopID || changes[0].TimelineLogID >= changes[1].TimelineLogID {
			t.Fatalf("round %d: changes %+v, want a chain %d → one → the other, in timeline order", round, changes, wrong)
		}

		if got := orderShop(t, h.DB(), orderID); got != changes[1].ToShopID {
			t.Fatalf("round %d: the order is in %d, the last change says %d", round, got, changes[1].ToShopID)
		}
	}
}

// A FIX AND A STATUS MOVE AT ONCE, × 20 rounds — the selling team claims the return while another fixes the shop.
// Whichever commits first, folding every event (in a scrambled order) leaves Return Created counted ONCE in all, under
// the shop the order is in now, and nothing under the old one: the fix carried the return over exactly when it came
// first, and a return after the fix counted under the new shop by itself. The move starts 20 ms late on odd rounds, so
// both orders are run — and the test asserts both were.
func TestRace_OrderShopUpdate_AgainstAStatusMove(t *testing.T) {
	h := orderRaceHarness(t)
	cleanShopFixFold(t, h)

	rec := &moveRecorder{}
	svc := newServiceWithEvents(t, h.DB(), rec.send)
	analytic := selling_v1.NewAnalytic(h.DB(), fakeTeamTypes{})
	wrong := insertShop(t, h.DB(), raceOrderTeam, "Race Wrong", "RS-W", "shopee")
	right := insertShop(t, h.DB(), raceOrderTeam, "Race Right", "RS-R", "shopee")

	returnFirst := 0

	for round := range 20 {
		rec.mu.Lock()
		rec.events = nil
		rec.mu.Unlock()

		orderID := completedRaceOrder(t, h, svc, wrong)

		res := h.Race(t, 2, func(i int) error {
			if i == 0 {
				return raceFix(svc, orderID, right)
			}

			if round%2 == 1 {
				time.Sleep(20 * time.Millisecond)
			}

			moved, err := raceMove(svc, raceOrderTeam, orderID, sellingv1.OrderStatus_ORDER_STATUS_RETURN)
			if err != nil {
				return err
			}

			if !moved.GetMoved() {
				return errors.New(moved.GetRefusedReason())
			}

			return nil
		})

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d calls failed — deadlocks %d", round, res.Failed(), res.Count(san_race.Deadlock))
		}

		changes := shopChanges(t, h.DB(), orderID)
		if len(changes) != 1 {
			t.Fatalf("round %d: %d changes, want 1", round, len(changes))
		}

		if eventCount(t, h.DB(), orderID, "return") != 1 {
			t.Fatalf("round %d: the return was not recorded once", round)
		}

		var returnLog uint64

		err := h.DB().Raw(`SELECT id FROM order_timeline_logs WHERE order_id = ? AND status = 'return'`, orderID).
			Scan(&returnLog).Error
		if err != nil {
			t.Fatalf("round %d: return row: %v", round, err)
		}

		if returnLog < changes[0].TimelineLogID {
			returnFirst++
		}

		// Fold the placement and every published event, the latest first — a scrambled delivery.
		foldEvent(t, analytic, placedEvent(orderID, changes[0].CreatedAt))

		rec.mu.Lock()
		events := append(rec.events[:0:0], rec.events...)
		rec.mu.Unlock()

		for i := len(events) - 1; i >= 0; i-- {
			if events[i].GetOrderPlaced() != nil {
				continue
			}

			err = analytic.FoldHandler()(context.Background(), events[i])
			if err != nil {
				t.Fatalf("round %d: fold %s: %v", round, events[i].GetEventId(), err)
			}
		}

		for metric, want := range map[string][2]int64{"created": {0, 1}, "return_created": {0, 1}} {
			got := [2]int64{}

			err = h.DB().Raw(`SELECT
			    COALESCE(SUM(order_count) FILTER (WHERE shop_id = ?), 0),
			    COALESCE(SUM(order_count) FILTER (WHERE shop_id = ?), 0)
			FROM order_daily_reports WHERE team_id = ? AND metric = ?`, wrong, right, raceOrderTeam, metric).
				Row().Scan(&got[0], &got[1])
			if err != nil {
				t.Fatalf("round %d: %s: %v", round, metric, err)
			}

			if got != want {
				t.Fatalf("round %d (return log %d, fix note %d): %s = %v under (old, new), want %v",
					round, returnLog, changes[0].TimelineLogID, metric, got, want)
			}
		}

		err = h.DB().Exec(`DELETE FROM order_daily_reports WHERE team_id = ?`, raceOrderTeam).Error
		if err != nil {
			t.Fatalf("round %d: reset report: %v", round, err)
		}
	}

	t.Logf("the return came first in %d of 20 rounds, the fix in %d", returnFirst, 20-returnFirst)

	if returnFirst == 0 || returnFirst == 20 {
		t.Fatalf("only one order was run (the return first in %d of 20) — the race proves nothing about the other", returnFirst)
	}
}

// FIXES CROSSING IN THE FOLD: two orders fixed in opposite directions (A → B, B → A) on the same day, folded at once
// with placements on both shops, × 10 rounds. Every fold writes its rows in one order (metric, then shop), so none
// waits on another in a cycle — no deadlock — and the counts net: each shop holds exactly its own orders.
func TestRace_OrderMetricFold_ShopFixesCross(t *testing.T) {
	h := orderRaceHarness(t)
	cleanShopFixFold(t, h)

	rec := &moveRecorder{}
	svc := newServiceWithEvents(t, h.DB(), rec.send)
	analytic := selling_v1.NewAnalytic(h.DB(), fakeTeamTypes{})
	shopA := insertShop(t, h.DB(), raceOrderTeam, "Race A", "RX-A", "shopee")
	shopB := insertShop(t, h.DB(), raceOrderTeam, "Race B", "RX-B", "shopee")

	for round := range 10 {
		rec.mu.Lock()
		rec.events = nil
		rec.mu.Unlock()

		ab := completedRaceOrder(t, h, svc, shopA)
		ba := completedRaceOrder(t, h, svc, shopB)
		stayA := completedRaceOrder(t, h, svc, shopA)
		stayB := completedRaceOrder(t, h, svc, shopB)

		err := raceFix(svc, ab, shopB)
		if err == nil {
			err = raceFix(svc, ba, shopA)
		}

		if err != nil {
			t.Fatalf("round %d: fix: %v", round, err)
		}

		rec.mu.Lock()
		fixes := append(rec.events[:0:0], rec.events...)
		rec.mu.Unlock()

		at := shopChanges(t, h.DB(), ab)[0].CreatedAt

		// Everything on one day: the four placements (folded first, so the fixes have something to take) …
		for _, id := range []uint64{ab, ba, stayA, stayB} {
			foldEvent(t, analytic, placedEvent(id, at))
		}

		// … then the two fixes and two more placements' redeliveries, all at once.
		res := h.Race(t, 4, func(i int) error {
			if i < 2 {
				return analytic.FoldHandler()(context.Background(), fixes[len(fixes)-2+i])
			}

			return analytic.FoldHandler()(context.Background(), placedEvent([]uint64{stayA, stayB}[i-2], at))
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d folds failed — deadlocks %d", round, res.Failed(), res.Count(san_race.Deadlock))
		}

		var perShop []struct {
			ShopID     uint64
			OrderCount int64
		}

		err = h.DB().Raw(`SELECT shop_id, SUM(order_count) AS order_count FROM order_daily_reports
		WHERE team_id = ? AND metric = 'created' GROUP BY shop_id ORDER BY shop_id`, raceOrderTeam).Scan(&perShop).Error
		if err != nil {
			t.Fatalf("round %d: %v", round, err)
		}

		want := fmt.Sprintf("[{%d %d} {%d %d}]", shopA, 2*(round+1), shopB, 2*(round+1))
		if got := fmt.Sprint(perShop); got != want {
			t.Fatalf("round %d: created per shop = %s, want %s", round, got, want)
		}
	}
}
