//go:build raceaudit

// Concurrency audit for the settlement FOLD (the audit-sql skill).
//
// WHY THE FOLD. It is a read-modify-write on money, and Pub/Sub delivers concurrently and out of order:
// several events for one shop arrive at the same moment, and a late one lands on a day that later days
// already carry forward from. Two bugs are possible and this file proves both absent:
//
//  1. A LOST CARRY. A live fold creating day 07 reads its `prev` close before a late fold on day 05
//     has committed, while the late fold's shift of `day > 05` cannot see the not-yet-inserted day 07.
//     Both commit, day 07 is understated — and `close − open = change` still holds on every row, so
//     nothing on the table can see it. The advisory lock per scope is what forbids the interleaving.
//  2. A DOUBLE FOLD. A redelivery storm of ONE event races the claim; only the primary key on
//     `settlement_event_logs.id` can settle it.
//
// Build-tagged because san_race COMMITS.
//
//	go test -tags raceaudit -run TestRace_Fold -v ./backend/services/settlement_service/settlement_v1/
package settlement_v1_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// ⚠ NOT settlement_service_metadata: the fold reads its lock row, and a harness that emptied that table
// would turn every fold into an error.
var foldTables = []string{
	"settlement_event_logs",
	"shop_settlement_daily_reports",
	"user_settlement_daily_reports",
	"shop_settlement_reports",
	"user_settlement_reports",
}

// ⚠ THE BUG THIS PROVES IS ABSENT: eight events on one shop, each on a DIFFERENT day, all at once and in
// REVERSE day order — so every one of them is a late event for some of the others. Whatever order they
// commit in, the stored carry must equal the running sum of the days.
func TestRace_Fold_ConcurrentDaysKeepTheCarryTrue(t *testing.T) {
	h := san_race.New(t, foldTables...)
	db := h.DB()
	svc := settlement_v1.NewService(db, nil, nil)
	ctx := context.Background()

	const n = 8

	events := make([]*eventsv1.Event, n)
	for i := 0; i < n; i++ {
		events[i] = logPosted(uint64(9000+i), fmt.Sprintf("2026-02-%02d", n-i), shop, order, creator, creator,
			settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, int64(1_000*(i+1)))
	}

	res := h.Race(t, n, func(i int) error {
		return svc.FoldHandler()(ctx, events[i])
	})

	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d of %d folds failed — every event was legitimate", res.Failed(), n)
	}

	rows := []settlement_service_models.ShopSettlementDailyReport{}

	err := db.Where("shop_id = ? AND team_id = ?", shop, team).Order("day ASC").Find(&rows).Error
	if err != nil {
		t.Fatalf("read the days: %v", err)
	}

	if len(rows) != n {
		t.Fatalf("%d day rows, want %d", len(rows), n)
	}

	// THE DEFINITION, checked row by row: open(D) is everything before D, close(D) everything up to it.
	var running int64

	for _, row := range rows {
		if row.OpenBalance != running {
			t.Fatalf("%s opens at %d, want %d — a late fold's shift and a live fold's prev lookup interleaved",
				row.Day.Format(time.DateOnly), row.OpenBalance, running)
		}

		running += row.Change

		if row.CloseBalance != running {
			t.Fatalf("%s closes at %d, want %d", row.Day.Format(time.DateOnly), row.CloseBalance, running)
		}
	}

	var state settlement_service_models.ShopSettlementReport

	err = db.Where("shop_id = ? AND team_id = ?", shop, team).Take(&state).Error
	if err != nil {
		t.Fatalf("read the shop state: %v", err)
	}

	if state.CloseBalance != running {
		t.Fatalf("shop state close = %d, want the newest day's %d", state.CloseBalance, running)
	}
}

// ⚠ THE BUG THIS PROVES IS ABSENT: one event delivered eight times at once is folded ONCE.
func TestRace_Fold_ARedeliveryStormFoldsOnce(t *testing.T) {
	h := san_race.New(t, foldTables...)
	db := h.DB()
	svc := settlement_v1.NewService(db, nil, nil)
	ctx := context.Background()

	const n = 8

	event := logPosted(9100, "2026-02-10", shop, order, creator, creator,
		settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 7_000)

	res := h.Race(t, n, func(int) error {
		return svc.FoldHandler()(ctx, event)
	})

	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d of %d redeliveries failed — a duplicate must ACK, not error", res.Failed(), n)
	}

	var claims int64

	err := db.Raw(`SELECT COUNT(*) FROM settlement_event_logs WHERE id = ?`, event.GetEventId()).Scan(&claims).Error
	if err != nil {
		t.Fatalf("count claims: %v", err)
	}

	var closeBalance int64

	err = db.Raw(`SELECT close_balance FROM shop_settlement_daily_reports WHERE shop_id = ? AND team_id = ? AND day = '2026-02-10'`,
		shop, team).Scan(&closeBalance).Error
	if err != nil {
		t.Fatalf("read the day: %v", err)
	}

	if claims != 1 || closeBalance != 7_000 {
		t.Fatalf("%d claims and a close of %d after %d deliveries of one event, want 1 and 7000", claims, closeBalance, n)
	}
}
