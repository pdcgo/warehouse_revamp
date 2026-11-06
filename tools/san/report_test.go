package main

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// `san report refold` on a day whose one log row was never folded: a dry run says what it would add and writes
// nothing; the real run adds the row, claims the event and names the person re-fold the claim now owes; that person
// re-fold counts the row; a second run of either changes nothing.
func TestReportRefold_RebuildsTheDayFromTheLog(t *testing.T) {
	db := san_testdb.DB(t)
	san := &San{db: db, settlement: NewSettlementReports(db), target: "test"}
	ctx := context.Background()

	day := time.Date(2026, 2, 3, 0, 0, 0, 0, time.UTC)
	order := uint64(7001)

	// The order's account, opened by person 3 — the person report counts the order's rows for them.
	err := db.Create(&settlement_service_models.OrderSettlement{OrderID: order, TeamID: 9, ShopID: 41, CreatedByUserID: 3}).Error
	if err != nil {
		t.Fatal(err)
	}

	err = db.Create(&settlement_service_models.SettlementLog{
		OrderID: &order, ShopID: 41, TeamID: 9, ActorID: 3,
		SourceType: "importer", SettlementType: "fund", Change: 25_000,
		UniqueID: "san-refold-1", OccurredOn: day, PostedOn: day, CreatedAt: time.Now().Add(-2 * time.Hour),
	}).Error
	if err != nil {
		t.Fatal(err)
	}

	in := settlement_v1.DayRefoldInput{Report: settlement_v1.ReportShopDaily, ShopID: 41, Day: "2026-02-03", DryRun: true}

	dry, err := san.ReportRefold(ctx, in)
	if err != nil {
		t.Fatal(err)
	}

	out := refoldLine(san.target, in, dry)
	for _, want := range []string{"DRY RUN", "shop 41", "lost and now claimed 1", "team 9: row added", "fund", "25.000"} {
		if !strings.Contains(out, want) {
			t.Fatalf("dry-run output lacks %q:\n%s", want, out)
		}
	}

	var rows int64

	err = db.Raw(`SELECT COUNT(*) FROM shop_settlement_daily_reports WHERE shop_id = 41`).Scan(&rows).Error
	if err != nil || rows != 0 {
		t.Fatalf("the dry run wrote %d rows (%v)", rows, err)
	}

	in.DryRun = false

	done, err := san.ReportRefold(ctx, in)
	if err != nil {
		t.Fatal(err)
	}

	out = refoldLine(san.target, in, done)
	t.Logf("the real run:\n%s", out)

	if !strings.Contains(out, "re-folded") || done.Claimed != 1 ||
		!strings.Contains(out, "settlement-user-daily is still short by them") ||
		!strings.Contains(out, "report refold --report settlement-user-daily --user 3 --date 2026-02-03") {
		t.Fatalf("real run = %+v:\n%s", done, out)
	}

	again, err := san.ReportRefold(ctx, in)
	if err != nil {
		t.Fatal(err)
	}

	if again.Changed() || again.Claimed != 0 || !strings.Contains(refoldLine(san.target, in, again), "team 9: unchanged") {
		t.Fatalf("a second run = %+v", again)
	}

	// THE PERSON RE-FOLD the output named.
	person, err := refoldInput(settlement_v1.ReportUserDaily, false, 0, true, 3)
	if err != nil {
		t.Fatal(err)
	}

	person.Day = "2026-02-03"

	repaired, err := san.ReportRefold(ctx, person)
	if err != nil {
		t.Fatal(err)
	}

	out = refoldLine(san.target, person, repaired)
	t.Logf("the person re-fold it names:\n%s", out)

	if repaired.Counted != 1 || repaired.Claimed != 0 || !strings.Contains(out, "settlement-user-daily · user 3") ||
		!strings.Contains(out, "team 9: row added") {
		t.Fatalf("person re-fold = %+v:\n%s", repaired, out)
	}

	second, err := san.ReportRefold(ctx, person)
	if err != nil || second.Changed() {
		t.Fatalf("a second person run = %+v, %v", second, err)
	}
}

// The flags name one scope, the one the report is keyed by — refused before any database is asked for.
func TestReportRefold_TheFlagsNameTheReportsScope(t *testing.T) {
	_, err := refoldInput(settlement_v1.ReportShopDaily, true, 41, true, 3)
	if !errors.Is(err, errRefoldShopFlag) {
		t.Fatalf("shop report with --user: %v", err)
	}

	_, err = refoldInput(settlement_v1.ReportUserDaily, true, 41, true, 3)
	if !errors.Is(err, errRefoldUserFlag) {
		t.Fatalf("person report with --shop: %v", err)
	}

	in, err := refoldInput(settlement_v1.ReportUserDaily, false, 0, true, 0)
	if err != nil || in.UserID == nil || *in.UserID != 0 {
		t.Fatalf("--user 0 is the person report's row of not recorded: %+v, %v", in, err)
	}

	in, err = refoldInput(settlement_v1.ReportUserDaily, false, 0, false, 0)
	if err != nil || in.UserID != nil {
		t.Fatalf("no --user leaves the scope empty for the service to refuse: %+v, %v", in, err)
	}
}
