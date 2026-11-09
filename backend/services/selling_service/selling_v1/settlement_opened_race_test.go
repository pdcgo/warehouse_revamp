//go:build raceaudit

// Concurrency audit for SettlementOpened (a-missing-account-is-found-by-its-opened-at) — the order service's one write
// for settlement: `UPDATE orders SET settlement_opened_at = ? WHERE id = ? AND settlement_opened_at IS NULL`, autocommit.
// Settlement calls it after every committed `initial_total` — the event's first delivery, its redeliveries (Pub/Sub
// delivers in parallel), a retry by hand — so two stamps of one order at once are normal. And the order may be moving at
// the same moment (a cancel holds it FOR UPDATE).
//
//	go test -tags raceaudit -p 1 -count=5 -run 'TestRace_SettlementOpened|TestInterleave_SettlementOpened' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

func openedAtOf(t *testing.T, db *gorm.DB, orderID uint64) *time.Time {
	t.Helper()

	var order selling_service_models.Order

	err := db.Select("id", "settlement_opened_at").Where("id = ?", orderID).Take(&order).Error
	if err != nil {
		t.Fatalf("read order %d: %v", orderID, err)
	}

	return order.SettlementOpenedAt
}

// EIGHT STAMPS OF ONE ORDER AT ONCE, × 10 rounds, each with its own moment: none fails, and the column holds exactly
// one of the eight — the first to commit; the rest found it set and changed nothing (the row lock queues them, and READ
// COMMITTED re-checks `IS NULL` on the row each waiter finally reads).
func TestRace_SettlementOpened_ManyStampsOneWins(t *testing.T) {
	h := orderRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Opened", "RO-1", "shopee")

	const stamps = 8

	base := time.Date(2026, 11, 5, 9, 0, 0, 0, time.UTC)

	for round := range 10 {
		order := raceOrder(t, svc, shopID)

		res := h.Race(t, stamps, func(i int) error {
			return svc.SettlementOpened(context.Background(), order, base.Add(time.Duration(i)*time.Minute))
		})
		if res.Failed() != 0 {
			res.Report(t)
			t.Fatalf("round %d: %d stamps failed", round, res.Failed())
		}

		at := openedAtOf(t, h.DB(), order)
		if at == nil {
			t.Fatalf("round %d: no stamp landed", round)
		}

		offset := at.Sub(base)
		if offset < 0 || offset > (stamps-1)*time.Minute || offset%time.Minute != 0 {
			t.Fatalf("round %d: settlement_opened_at = %v, not one of the eight stamps", round, at)
		}
	}
}

// A STAMP WHILE THE ORDER IS LOCKED: a cancel's transaction holds the order FOR UPDATE; the stamp waits on the row (it
// holds nothing itself, so it is never half of a cycle), lands when the cancel commits, and the cancel's write did not
// erase it — the two write different columns.
func TestInterleave_SettlementOpened_WaitsForALockedOrder(t *testing.T) {
	h := orderRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Opened", "RO-2", "shopee")
	order := raceOrder(t, svc, shopID)
	at := time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)

	s := h.Interleave(t,
		san_race.Do("cancel", "lock the order", func(tx *gorm.DB) error {
			return tx.Exec(`SELECT id FROM orders WHERE id = ? FOR UPDATE`, order).Error
		}),
		san_race.Block("stamp", "stamp it", func(tx *gorm.DB) error {
			return newService(t, tx).SettlementOpened(context.Background(), order, at)
		}),
		san_race.Do("cancel", "move the status", func(tx *gorm.DB) error {
			return tx.Exec(`UPDATE orders SET status = 'cancel' WHERE id = ?`, order).Error
		}),
		san_race.Commit("cancel"),
		san_race.Commit("stamp"),
	)
	s.Report(t)

	step := s.Get("stamp it")
	if !step.Blocked || !step.Released || step.Err != nil {
		t.Fatalf("the stamp: blocked=%v released=%v err=%v — want it to wait on the cancel and then land",
			step.Blocked, step.Released, step.Err)
	}

	got := openedAtOf(t, h.DB(), order)
	if got == nil || !got.Equal(at) {
		t.Fatalf("after the cancel committed, settlement_opened_at = %v, want %v", got, at)
	}
}
