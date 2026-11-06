package settlement_v1_test

import (
	"context"
	"testing"
	"time"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// THE-SYSTEM-RUNS-ON-JAKARTA-TIME, on settlement's own bucket day. `posted_on` is `DEFAULT CURRENT_DATE` — the
// session's today — and nothing in settlement converts, so the session's zone IS the report's calendar.
//
// A post at 23:30 UTC on 4 Nov is 06:30 WIB on 5 Nov, and must land on 5 Nov: on the log row, on the event the fold
// reads, and on the report row the fold writes.
//
// Postgres has no clock to set, so the test pins the default to that instant's day AS THE SESSION CASTS IT —
// `CURRENT_DATE` is exactly `CAST(now() AS date)` in the session's zone. Under UTC the cast gives 4 Nov and the test
// fails; the ALTER rolls back with the test's transaction.
func TestSettlementPost_APostAt2330UTCLandsOnTheJakartaDay(t *testing.T) {
	db := san_testdb.DB(t)

	err := db.Exec(`ALTER TABLE settlement_logs ALTER COLUMN posted_on
		SET DEFAULT CAST(TIMESTAMPTZ '2026-11-04 23:30:00+00' AS date)`).Error
	if err != nil {
		t.Fatal(err)
	}

	var published []*eventsv1.Event

	sender := func(_ context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
		published = append(published, event)

		return nil
	}

	svc := settlement_v1.NewService(db, sender, nil, nil, nil)

	result, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("PostEntry: %v", err)
	}

	if got := result.Entry.PostedOn.Format(time.DateOnly); got != "2026-11-05" {
		t.Fatalf("posted_on = %s, want 2026-11-05 — 23:30 UTC is 06:30 WIB the next day", got)
	}

	if len(published) != 1 || published[0].GetSettlementLogPosted().GetPostedOn() != "2026-11-05" {
		t.Fatalf("the event carries posted_on %q, want 2026-11-05", published[0].GetSettlementLogPosted().GetPostedOn())
	}

	fold(t, svc, published...)

	_, days := shopDays(t, db, shop)
	if len(days) != 1 || days[0].Format(time.DateOnly) != "2026-11-05" {
		t.Fatalf("the report row is on %v, want 2026-11-05", days)
	}
}
