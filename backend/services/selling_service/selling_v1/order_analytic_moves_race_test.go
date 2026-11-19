//go:build raceaudit

// Concurrency audit for Order status moves' fold (the audit-sql skill, the-order-status-moves-prototype-is-accepted).
//
// A move is folded like the five's: one transaction — the claim, one read of the order (and its shop as of the move),
// one upsert into its count's row of order_daily_reports. Moves of one order and of different orders arrive in parallel
// and at least once; two moves of ONE order on one day write two DIFFERENT rows (each count its own `metric` value),
// two orders' same move on one day write the SAME row. Neither may lose an increment, double a redelivery or deadlock.
//
//	go test -tags raceaudit -count=1 -run 'TestRace_OrderMovesFold' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"testing"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// raceTimelineRow writes a committed timeline row into `status` for the order — the row a move's event names.
func raceTimelineRow(t *testing.T, h *san_race.Harness, orderID uint64, status string) uint64 {
	t.Helper()

	row := selling_service_models.OrderTimelineLog{OrderID: orderID, Status: status, From: "warehouse", CreatedAt: foldAt}

	err := h.DB().Create(&row).Error
	if err != nil {
		t.Fatalf("timeline row %s for %d: %v", status, orderID, err)
	}

	return row.ID
}

// TWO MOVES OF ONE ORDER AND TWO ORDERS ON ONE DAY AT ONCE, × 10 rounds: orders A and B (same day, shop, warehouse and
// creator) are each confirmed and picked, and A's confirm is delivered twice — five folds together. A's two moves lock
// two different rows; A's and B's confirms queue on one row, as do their picks. Every round adds exactly 2 to the
// Confirmed row and 2 to the Picked row: nothing lost, the redelivery counted once, no deadlock.
func TestRace_OrderMovesFold_TwoMovesOfOneOrderAndTwoOrdersOnOneDay(t *testing.T) {
	h := orderRaceHarness(t)
	cleanShopFixFold(t, h)

	svc := newService(t, h.DB())
	analytic := selling_v1.NewAnalytic(h.DB(), fakeTeamTypes{})
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Moves", "RM-1", "shopee")

	for round := range 10 {
		a, b := raceOrder(t, svc, shopID), raceOrder(t, svc, shopID)

		confirmA := movedBy(a, raceTimelineRow(t, h, a, "processed"), "pending", "processed", 55, foldAt)
		events := []*eventsv1.Event{
			confirmA,
			movedBy(a, raceTimelineRow(t, h, a, "picked"), "processed", "picked", 55, foldAt),
			movedBy(b, raceTimelineRow(t, h, b, "processed"), "pending", "processed", 55, foldAt),
			movedBy(b, raceTimelineRow(t, h, b, "picked"), "processed", "picked", 55, foldAt),
			confirmA, // the redelivery
		}

		res := h.Race(t, len(events), func(i int) error {
			return analytic.FoldHandler()(context.Background(), events[i])
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d folds failed — deadlocks %d", round, res.Failed(), res.Count(san_race.Deadlock))
		}

		want := int64(2 * (round + 1))

		if got := foldCount(t, h, "moves_confirmed"); got != want {
			t.Fatalf("round %d: Confirmed counts %d, want %d — an increment was lost or the redelivery counted", round, got, want)
		}

		if got := foldCount(t, h, "moves_picked"); got != want {
			t.Fatalf("round %d: Picked counts %d, want %d — an increment was lost", round, got, want)
		}
	}
}
