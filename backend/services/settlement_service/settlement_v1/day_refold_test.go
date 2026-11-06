package settlement_v1_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// a-wrong-day-is-refolded-from-the-log — one report, one scope, one date, rebuilt from the log;
// a-refold-shifts-the-later-days — every later day's carry follows by exactly the difference;
// the-person-report-refolds-too — the person report the same way, and a lost row one re-fold claims is counted by the
// other's.

// refoldLogRowAt writes one ORDER row as SettlementPost would have — the order's account opened by `creator` first, as
// the post that opens it stamps — on a chosen posted day and written `age` ago, and returns the event its post published:
// the fold's input, keyed by the row's id.
func refoldLogRowAt(
	t *testing.T,
	db *gorm.DB,
	shopID, orderID uint64,
	day string,
	settlementType settlementv1.SettlementType,
	change float64,
	age time.Duration,
) *eventsv1.Event {
	t.Helper()

	posted, err := time.Parse(time.DateOnly, day)
	if err != nil {
		t.Fatal(err)
	}

	err = db.
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&settlement_service_models.OrderSettlement{OrderID: orderID, TeamID: team, ShopID: shopID, CreatedByUserID: creator}).
		Error
	if err != nil {
		t.Fatalf("order account: %v", err)
	}

	row := settlement_service_models.SettlementLog{
		OrderID:        &orderID,
		ShopID:         shopID,
		TeamID:         team,
		ActorID:        creator,
		SourceType:     "importer",
		SettlementType: settlement_v1.SettlementTypeText(settlementType),
		Change:         change,
		UniqueID:       fmt.Sprintf("refold-%v-%v-%s-%v-%v-%v", shopID, orderID, day, settlementType, change, age),
		OccurredOn:     posted,
		PostedOn:       posted,
		CreatedAt:      time.Now().Add(-age),
	}

	err = db.Create(&row).Error
	if err != nil {
		t.Fatalf("log row: %v", err)
	}

	return logPosted(row.ID, day, shopID, orderID, creator, creator, settlementType, change)
}

// refoldLogRow is refoldLogRowAt on the package's shop and order.
func refoldLogRow(
	t *testing.T,
	db *gorm.DB,
	day string,
	settlementType settlementv1.SettlementType,
	change float64,
	age time.Duration,
) *eventsv1.Event {
	t.Helper()

	return refoldLogRowAt(t, db, shop, order, day, settlementType, change, age)
}

// refoldShopRow writes one SHOP row — no order — naming `userID` (an imported row's primary CS, 0 on a hand-posted one)
// and its actor, and returns the event its post published.
func refoldShopRow(
	t *testing.T,
	db *gorm.DB,
	day string,
	userID, actor uint64,
	settlementType settlementv1.SettlementType,
	change float64,
) *eventsv1.Event {
	t.Helper()

	posted, err := time.Parse(time.DateOnly, day)
	if err != nil {
		t.Fatal(err)
	}

	row := settlement_service_models.SettlementLog{
		ShopID:         shop,
		TeamID:         team,
		ActorID:        actor,
		UserID:         userID,
		SourceType:     "importer",
		SettlementType: settlement_v1.SettlementTypeText(settlementType),
		Change:         change,
		UniqueID:       fmt.Sprintf("refold-shop-row-%s-%v-%v-%v", day, userID, actor, change),
		OccurredOn:     posted,
		PostedOn:       posted,
		CreatedAt:      time.Now().Add(-48 * time.Hour),
	}

	err = db.Create(&row).Error
	if err != nil {
		t.Fatalf("shop log row: %v", err)
	}

	return &eventsv1.Event{
		EventId:     fmt.Sprintf("settlement-log:%d", row.ID),
		OccurredAt:  timestamppb.Now(),
		AggregateId: fmt.Sprintf("shop:%d", shop),
		Message: &eventsv1.Event_SettlementLogPosted{
			SettlementLogPosted: &eventsv1.SettlementLogPosted{
				LogId:          row.ID,
				UniqueId:       row.UniqueID,
				ShopId:         shop,
				TeamId:         team,
				ActorId:        actor,
				UserId:         userID,
				SettlementType: settlementType,
				SourceType:     settlementv1.SourceType_SOURCE_TYPE_IMPORTER,
				Change:         change,
				PostedOn:       day,
				OccurredOn:     day,
			},
		},
	}
}

func refold(t *testing.T, svc *settlement_v1.Service, day string, dryRun bool) settlement_v1.DayRefoldResult {
	t.Helper()

	result, err := svc.DayRefold(context.Background(), settlement_v1.DayRefoldInput{
		Report: settlement_v1.ReportShopDaily,
		ShopID: shop,
		Day:    day,
		DryRun: dryRun,
	})
	if err != nil {
		t.Fatalf("DayRefold %s: %v", day, err)
	}

	return result
}

func refoldPerson(t *testing.T, svc *settlement_v1.Service, user uint64, day string, dryRun bool) settlement_v1.DayRefoldResult {
	t.Helper()

	result, err := svc.DayRefold(context.Background(), settlement_v1.DayRefoldInput{
		Report: settlement_v1.ReportUserDaily,
		UserID: &user,
		Day:    day,
		DryRun: dryRun,
	})
	if err != nil {
		t.Fatalf("DayRefold person %d %s: %v", user, day, err)
	}

	return result
}

func shopRows(t *testing.T, db *gorm.DB) map[string]settlement_service_models.ShopSettlementDailyReport {
	t.Helper()

	rows := []settlement_service_models.ShopSettlementDailyReport{}

	err := db.Where("shop_id = ? AND team_id = ?", shop, team).Order("day").Find(&rows).Error
	if err != nil {
		t.Fatal(err)
	}

	out := map[string]settlement_service_models.ShopSettlementDailyReport{}
	for _, row := range rows {
		out[row.Day.Format(time.DateOnly)] = row
	}

	return out
}

func personRows(t *testing.T, db *gorm.DB, user uint64) map[string]settlement_service_models.UserSettlementDailyReport {
	t.Helper()

	rows := []settlement_service_models.UserSettlementDailyReport{}

	err := db.Where("user_id = ? AND team_id = ?", user, team).Order("day").Find(&rows).Error
	if err != nil {
		t.Fatal(err)
	}

	out := map[string]settlement_service_models.UserSettlementDailyReport{}
	for _, row := range rows {
		out[row.Day.Format(time.DateOnly)] = row
	}

	return out
}

// rowVersions is each day row's physical version (ctid) — any write moves it, even inside the test's one transaction,
// where NOW() and so `last_updated` never change.
func rowVersions(t *testing.T, db *gorm.DB, table, keyColumn string, key uint64) map[string]string {
	t.Helper()

	rows := []struct {
		Day     time.Time
		Version string
	}{}

	err := db.
		Raw(fmt.Sprintf(`SELECT day, ctid::text AS version FROM %s WHERE %s = ? AND team_id = ?`, table, keyColumn), key, team).
		Scan(&rows).
		Error
	if err != nil {
		t.Fatal(err)
	}

	out := map[string]string{}
	for _, row := range rows {
		out[row.Day.Format(time.DateOnly)] = row.Version
	}

	return out
}

func shopStateClose(t *testing.T, db *gorm.DB, shopID uint64) float64 {
	t.Helper()

	var state settlement_service_models.ShopSettlementReport

	err := db.Where("shop_id = ? AND team_id = ?", shopID, team).Take(&state).Error
	if err != nil {
		t.Fatal(err)
	}

	return state.CloseBalance
}

func personState(t *testing.T, db *gorm.DB, user uint64) settlement_service_models.UserSettlementReport {
	t.Helper()

	var state settlement_service_models.UserSettlementReport

	err := db.Where("user_id = ? AND team_id = ?", user, team).Take(&state).Error
	if err != nil {
		t.Fatal(err)
	}

	return state
}

// movementOf is a row's movement — every figure but the carried position.
func movementOf(c settlement_service_models.SettlementMetricColumns) settlement_service_models.SettlementMetricColumns {
	c.OpenBalance = 0
	c.CloseBalance = 0

	return c
}

// threeDays is a sale, a fee and a fund over three days, every one folded — both reports agree with the log.
//
//	01-01  initial_total −120.000                 open        0  close −120.000
//	01-02  ads −10.000, fund +40.000  (+30.000)   open −120.000  close  −90.000
//	01-03  fund +60.000                           open  −90.000  close  −30.000
func threeDays(t *testing.T, db *gorm.DB, svc *settlement_v1.Service) {
	t.Helper()

	fold(t, svc,
		refoldLogRow(t, db, "2026-01-01", settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL, -sale, 48*time.Hour),
		refoldLogRow(t, db, "2026-01-02", settlementv1.SettlementType_SETTLEMENT_TYPE_EXTERNAL_ADS_FEE, -10_000, 48*time.Hour),
		refoldLogRow(t, db, "2026-01-02", settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 40_000, 48*time.Hour),
		refoldLogRow(t, db, "2026-01-03", settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 60_000, 48*time.Hour),
	)
}

// wrongFold damages one day the way a wrong fold would: 01-02 reads +1 instead of +30.000, and — as the fold shifts the
// later days for whatever it adds — 01-03 and the scope's state row carry the same −29.999.
func wrongFold(t *testing.T, db *gorm.DB, table, stateTable, keyColumn string, key uint64) {
	t.Helper()

	for _, statement := range []string{
		`UPDATE %[1]s SET fund = 1, external_ads_fee = 0, change = 1, close_balance = open_balance + 1
		 WHERE %[3]s = ? AND team_id = ? AND day = DATE '2026-01-02'`,
		`UPDATE %[1]s SET open_balance = open_balance - 29999, close_balance = close_balance - 29999
		 WHERE %[3]s = ? AND team_id = ? AND day > DATE '2026-01-02'`,
		`UPDATE %[2]s SET close_balance = close_balance - 29999 WHERE %[3]s = ? AND team_id = ?`,
	} {
		err := db.Exec(fmt.Sprintf(statement, table, stateTable, keyColumn), key, team).Error
		if err != nil {
			t.Fatal(err)
		}
	}
}

// A WRONG DAY is rewritten to match the log, and every later day's open and close move back by exactly the difference
// — their movement untouched — as does the state row. An earlier day is not written. A second run writes nothing.
func TestDayRefold_RewritesAWrongDayAndShiftsTheLaterCarry(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil)

	threeDays(t, db, svc)

	good := shopRows(t, db)

	wrongFold(t, db, "shop_settlement_daily_reports", "shop_settlement_reports", "shop_id", shop)

	wrong := shopRows(t, db)
	versions := rowVersions(t, db, "shop_settlement_daily_reports", "shop_id", shop)

	result := refold(t, svc, "2026-01-02", false)
	if !result.Changed() || result.Counted != 2 || result.Claimed != 0 || result.InFlight != 0 {
		t.Fatalf("result = %+v — two folded rows counted, nothing claimed or in flight, and the row changed", result)
	}

	if len(result.Teams) != 1 || result.Teams[0].CarryDelta != 29_999 || result.Teams[0].LaterDays != 1 ||
		result.Teams[0].NextDay != "2026-01-03" || result.Teams[0].NextGap != 0 {
		t.Fatalf("teams = %+v — 01-02's close moved by 30.000 − 1, one later day shifted, its carry chains", result.Teams)
	}

	after := shopRows(t, db)

	if got, want := after["2026-01-02"].SettlementMetricColumns, good["2026-01-02"].SettlementMetricColumns; got != want {
		t.Fatalf("01-02 = %+v, want the log's %+v", got, want)
	}

	// THE LATER DAY: open and close moved by exactly the difference, back to what the log implies; its movement is its own.
	later, wrongLater := after["2026-01-03"], wrong["2026-01-03"]
	if later.OpenBalance-wrongLater.OpenBalance != 29_999 || later.CloseBalance-wrongLater.CloseBalance != 29_999 {
		t.Fatalf("01-03 open/close moved by %v/%v, want 29.999 each", later.OpenBalance-wrongLater.OpenBalance, later.CloseBalance-wrongLater.CloseBalance)
	}

	if movementOf(later.SettlementMetricColumns) != movementOf(wrongLater.SettlementMetricColumns) {
		t.Fatalf("01-03's movement was touched: %+v, was %+v", later.SettlementMetricColumns, wrongLater.SettlementMetricColumns)
	}

	if later.SettlementMetricColumns != good["2026-01-03"].SettlementMetricColumns {
		t.Fatalf("01-03 = %+v, want the folded %+v", later.SettlementMetricColumns, good["2026-01-03"].SettlementMetricColumns)
	}

	// AN EARLIER DAY is not written at all.
	if now := rowVersions(t, db, "shop_settlement_daily_reports", "shop_id", shop); now["2026-01-01"] != versions["2026-01-01"] {
		t.Fatal("01-01 was written")
	}

	if got := shopStateClose(t, db, shop); got != -30_000 {
		t.Fatalf("shop state close = %v, want −30.000 — moved back by the same difference", got)
	}

	// IDEMPOTENT: nothing moves, nothing is written.
	settled := rowVersions(t, db, "shop_settlement_daily_reports", "shop_id", shop)

	again := refold(t, svc, "2026-01-02", false)
	if again.Changed() || again.Claimed != 0 || again.Teams[0].CarryDelta != 0 || again.Teams[0].LaterDays != 0 {
		t.Fatalf("a second run = %+v, want no change — the re-fold is idempotent", again)
	}

	if now := rowVersions(t, db, "shop_settlement_daily_reports", "shop_id", shop); fmt.Sprint(now) != fmt.Sprint(settled) {
		t.Fatalf("the second run wrote rows: %v, was %v", now, settled)
	}

	if got := shopStateClose(t, db, shop); got != -30_000 {
		t.Fatalf("shop state close after a second run = %v", got)
	}
}

// A LOST EVENT — the log holds a row the fold never saw. The re-fold counts it and CLAIMS it, so its late
// redelivery folds nothing; the day then equals the log and the later day's carry follows by the lost −5.000.
func TestDayRefold_CountsALostRowAndClaimsIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil)

	threeDays(t, db, svc)

	lost := refoldLogRow(t, db, "2026-01-02", settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER, -5_000, 3*time.Hour)

	result := refold(t, svc, "2026-01-02", false)
	if result.Counted != 3 || result.Claimed != 1 {
		t.Fatalf("result = %+v — three rows counted, the lost one claimed", result)
	}

	// The person report is short by it now, and the result says whose re-fold repairs it.
	if result.OtherReport != settlement_v1.ReportUserDaily || len(result.Short) != 1 || result.Short[0] != creator {
		t.Fatalf("short = %s %v, want %s [%d]", result.OtherReport, result.Short, settlement_v1.ReportUserDaily, creator)
	}

	rows := shopRows(t, db)

	day := rows["2026-01-02"]
	if day.Other != -5_000 || day.Change != 25_000 || day.OpenBalance != -sale || day.CloseBalance != -sale+25_000 {
		t.Fatalf("01-02 = %+v — the lost -5.000 is in it", day.SettlementMetricColumns)
	}

	if later := rows["2026-01-03"]; later.OpenBalance != -95_000 || later.CloseBalance != -35_000 || later.Fund != 60_000 {
		t.Fatalf("01-03 = %+v — its carry follows by −5.000, its fund untouched", later.SettlementMetricColumns)
	}

	if got := shopStateClose(t, db, shop); got != -35_000 {
		t.Fatalf("shop state close = %v, want −35.000", got)
	}

	fold(t, svc, lost)

	if again := shopRows(t, db); again["2026-01-02"].SettlementMetricColumns != day.SettlementMetricColumns ||
		again["2026-01-03"].SettlementMetricColumns != rows["2026-01-03"].SettlementMetricColumns {
		t.Fatalf("the lost event's redelivery folded again: %+v", again)
	}
}

// A QUIET DAY whose one row was lost has no report row at all. The re-fold adds it, opening from the day before, and
// every later day shifts by its whole change.
func TestDayRefold_AQuietDayGainsItsRowAndEveryLaterDayFollows(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil)

	threeDays(t, db, svc)

	before := shopRows(t, db)

	refoldLogRow(t, db, "2025-12-31", settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 7_000, 3*time.Hour)

	result := refold(t, svc, "2025-12-31", false)
	if result.Claimed != 1 || result.Teams[0].Before != nil || result.Teams[0].CarryDelta != 7_000 || result.Teams[0].LaterDays != 3 {
		t.Fatalf("result = %+v, teams %+v — a row added, its 7.000 carried into three later days", result, result.Teams)
	}

	after := shopRows(t, db)

	if added := after["2025-12-31"]; added.OpenBalance != 0 || added.CloseBalance != 7_000 || added.Fund != 7_000 {
		t.Fatalf("12-31 = %+v", added.SettlementMetricColumns)
	}

	for _, day := range []string{"2026-01-01", "2026-01-02", "2026-01-03"} {
		if after[day].OpenBalance != before[day].OpenBalance+7_000 || after[day].CloseBalance != before[day].CloseBalance+7_000 ||
			movementOf(after[day].SettlementMetricColumns) != movementOf(before[day].SettlementMetricColumns) {
			t.Fatalf("%s = %+v, was %+v — open/close +7.000, movement the same", day, after[day].SettlementMetricColumns, before[day].SettlementMetricColumns)
		}
	}

	if got := shopStateClose(t, db, shop); got != -23_000 {
		t.Fatalf("shop state close = %v, want −23.000", got)
	}
}

// AN EVENT IN FLIGHT — a row written a moment ago and not folded yet — is left to the fold, which adds it after.
func TestDayRefold_LeavesARowInFlightToTheFold(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil)

	threeDays(t, db, svc)

	young := refoldLogRow(t, db, "2026-01-03", settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 7_000, time.Minute)

	result := refold(t, svc, "2026-01-03", false)
	if result.Counted != 1 || result.InFlight != 1 || result.Claimed != 0 || result.Changed() || len(result.Short) != 0 {
		t.Fatalf("result = %+v — the folded row counted, the young one in flight, the day unchanged", result)
	}

	fold(t, svc, young)

	if day := shopRows(t, db)["2026-01-03"]; day.Fund != 67_000 {
		t.Fatalf("01-03 fund = %v, want 67.000 — the fold added the row in flight once", day.Fund)
	}
}

// A DRY RUN shows the row it would write and the shift it would make, and writes nothing.
func TestDayRefold_ADryRunWritesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil)

	threeDays(t, db, svc)
	refoldLogRow(t, db, "2026-01-02", settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER, -5_000, 3*time.Hour)

	before := shopRows(t, db)

	result := refold(t, svc, "2026-01-02", true)
	if !result.DryRun || !result.Changed() || result.Claimed != 1 || result.Teams[0].After.Other != -5_000 ||
		result.Teams[0].CarryDelta != -5_000 || result.Teams[0].LaterDays != 1 {
		t.Fatalf("dry run = %+v, teams %+v", result, result.Teams)
	}

	if after := shopRows(t, db); fmt.Sprint(after) != fmt.Sprint(before) {
		t.Fatal("the dry run wrote a row")
	}

	if got := shopStateClose(t, db, shop); got != -30_000 {
		t.Fatalf("the dry run moved the state row: %v", got)
	}

	var claims int64

	err := db.Raw(`SELECT COUNT(*) FROM settlement_event_logs WHERE day = DATE '2026-01-02'`).Scan(&claims).Error
	if err != nil {
		t.Fatal(err)
	}

	if claims != 2 {
		t.Fatalf("%d claims on 01-02, want the two folds' — the dry run claimed", claims)
	}
}

// A day whose log holds nothing countable has no row (00005), and the re-fold removes a stray one. A scope left with
// no row at all reads 0 in its state row.
func TestDayRefold_RemovesARowTheLogDoesNotHold(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil)

	threeDays(t, db, svc)

	const strayShop uint64 = 77

	for _, statement := range []string{
		`INSERT INTO shop_settlement_daily_reports (day, shop_id, team_id, fund, change, open_balance, close_balance)
		 VALUES (DATE '2026-01-05', 30, 2, 9, 9, -30000, -29991)`,
		`INSERT INTO shop_settlement_daily_reports (day, shop_id, team_id, fund, change, open_balance, close_balance)
		 VALUES (DATE '2026-01-05', 77, 2, 9, 9, 0, 9)`,
		`INSERT INTO shop_settlement_reports (shop_id, team_id, close_balance) VALUES (77, 2, 9)`,
	} {
		err := db.Exec(statement).Error
		if err != nil {
			t.Fatal(err)
		}
	}

	result := refold(t, svc, "2026-01-05", false)
	if len(result.Teams) != 1 || result.Teams[0].After != nil || result.Teams[0].Before == nil || result.Teams[0].CarryDelta != -9 {
		t.Fatalf("result = %+v — the stray row removed", result)
	}

	if _, ok := shopRows(t, db)["2026-01-05"]; ok {
		t.Fatal("the stray row is still there")
	}

	if got := shopStateClose(t, db, shop); got != -30_000 {
		t.Fatalf("shop state close = %v — re-derived from 01-03, the newest row again", got)
	}

	_, err := svc.DayRefold(context.Background(), settlement_v1.DayRefoldInput{Report: settlement_v1.ReportShopDaily, ShopID: strayShop, Day: "2026-01-05"})
	if err != nil {
		t.Fatal(err)
	}

	if got := shopStateClose(t, db, strayShop); got != 0 {
		t.Fatalf("an emptied shop's state close = %v, want 0", got)
	}
}

// A CARRY ALREADY OFF after the day — the next row opens away from this day's close — is kept by a shift and named in
// the result; re-folding that next day closes it.
func TestDayRefold_NamesACarryAlreadyOffAndItsOwnRefoldClosesIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil)

	threeDays(t, db, svc)

	err := db.Exec(`UPDATE shop_settlement_daily_reports SET open_balance = open_balance + 500, close_balance = close_balance + 500
		WHERE shop_id = ? AND team_id = ? AND day = DATE '2026-01-03'`, shop, team).Error
	if err != nil {
		t.Fatal(err)
	}

	first := refold(t, svc, "2026-01-02", false)
	if first.Changed() || first.Teams[0].NextDay != "2026-01-03" || first.Teams[0].NextGap != 500 {
		t.Fatalf("teams = %+v — 01-02 is right, 01-03 opens 500 off it", first.Teams)
	}

	second := refold(t, svc, "2026-01-03", false)
	if !second.Changed() || second.Teams[0].CarryDelta != -500 || second.Teams[0].NextGap != 0 {
		t.Fatalf("teams = %+v — 01-03 re-opens from 01-02's close", second.Teams)
	}

	if day := shopRows(t, db)["2026-01-03"]; day.OpenBalance != -90_000 || day.CloseBalance != -30_000 {
		t.Fatalf("01-03 = %+v", day.SettlementMetricColumns)
	}

	if got := shopStateClose(t, db, shop); got != -30_000 {
		t.Fatalf("shop state close = %v", got)
	}
}

func TestDayRefold_Refuses(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil)
	ctx := context.Background()

	user := creator

	for name, in := range map[string]settlement_v1.DayRefoldInput{
		"an unknown report":             {Report: "settlement-daily", ShopID: shop, Day: "2026-01-02"},
		"no shop":                       {Report: settlement_v1.ReportShopDaily, Day: "2026-01-02"},
		"the shop report with a user":   {Report: settlement_v1.ReportShopDaily, ShopID: shop, UserID: &user, Day: "2026-01-02"},
		"no user":                       {Report: settlement_v1.ReportUserDaily, Day: "2026-01-02"},
		"the person report with a shop": {Report: settlement_v1.ReportUserDaily, ShopID: shop, UserID: &user, Day: "2026-01-02"},
		"not a day":                     {Report: settlement_v1.ReportShopDaily, ShopID: shop, Day: "02-01-2026"},
	} {
		_, err := svc.DayRefold(ctx, in)
		if err == nil {
			t.Fatalf("%s: no error", name)
		}
	}

	err := db.Exec(`UPDATE settlement_service_metadata SET value = '{"lock":true}', updated_at = NOW() WHERE key = 'process_event_lock'`).Error
	if err != nil {
		t.Fatal(err)
	}

	for _, in := range []settlement_v1.DayRefoldInput{
		{Report: settlement_v1.ReportShopDaily, ShopID: shop, Day: "2026-01-02"},
		{Report: settlement_v1.ReportUserDaily, UserID: &user, Day: "2026-01-02"},
	} {
		_, err = svc.DayRefold(ctx, in)
		if err == nil || !errors.Is(err, settlement_v1.ErrRefoldLocked) {
			t.Fatalf("%s under a replay's lock: %v, want ErrRefoldLocked", in.Report, err)
		}
	}
}

// ─── the person report ────────────────────────────────────────────────────────────────────────────────────────────────

// The person report's wrong day, mirrored: rewritten, the later day and the state row moved back by the difference, the
// earlier day not written, a second run writes nothing.
func TestDayRefold_Person_RewritesAWrongDayAndShiftsTheLaterCarry(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil)

	threeDays(t, db, svc)

	good := personRows(t, db, creator)

	wrongFold(t, db, "user_settlement_daily_reports", "user_settlement_reports", "user_id", creator)

	wrong := personRows(t, db, creator)
	versions := rowVersions(t, db, "user_settlement_daily_reports", "user_id", creator)
	shopBefore := rowVersions(t, db, "shop_settlement_daily_reports", "shop_id", shop)

	result := refoldPerson(t, svc, creator, "2026-01-02", false)
	if !result.Changed() || result.Counted != 2 || result.Claimed != 0 || len(result.Teams) != 1 ||
		result.Teams[0].CarryDelta != 29_999 || result.Teams[0].LaterDays != 1 || result.Teams[0].NextGap != 0 {
		t.Fatalf("result = %+v, teams %+v", result, result.Teams)
	}

	after := personRows(t, db, creator)

	for _, day := range []string{"2026-01-02", "2026-01-03"} {
		if after[day].SettlementMetricColumns != good[day].SettlementMetricColumns {
			t.Fatalf("%s = %+v, want the folded %+v", day, after[day].SettlementMetricColumns, good[day].SettlementMetricColumns)
		}
	}

	if movementOf(after["2026-01-03"].SettlementMetricColumns) != movementOf(wrong["2026-01-03"].SettlementMetricColumns) {
		t.Fatal("01-03's movement was touched")
	}

	if now := rowVersions(t, db, "user_settlement_daily_reports", "user_id", creator); now["2026-01-01"] != versions["2026-01-01"] {
		t.Fatal("01-01 was written")
	}

	// THE SHOP REPORT is not the person re-fold's: not one of its rows is written.
	if now := rowVersions(t, db, "shop_settlement_daily_reports", "shop_id", shop); fmt.Sprint(now) != fmt.Sprint(shopBefore) {
		t.Fatal("the person re-fold wrote the shop report")
	}

	state := personState(t, db, creator)
	if state.CloseBalance != -30_000 || state.LastDay == nil || state.LastDay.Format(time.DateOnly) != "2026-01-03" {
		t.Fatalf("person state = %+v — close −30.000, last day 01-03", state)
	}

	settled := rowVersions(t, db, "user_settlement_daily_reports", "user_id", creator)

	again := refoldPerson(t, svc, creator, "2026-01-02", false)
	if again.Changed() || again.Teams[0].CarryDelta != 0 || again.Teams[0].LaterDays != 0 {
		t.Fatalf("a second run = %+v", again)
	}

	if now := rowVersions(t, db, "user_settlement_daily_reports", "user_id", creator); fmt.Sprint(now) != fmt.Sprint(settled) {
		t.Fatal("the second run wrote rows")
	}
}

// EACH ROW COUNTS FOR WHOM THE FOLD COUNTS IT: an order row for the order's creator, an imported shop row for its
// primary CS, a hand-posted shop row for its actor. A person's day wiped from the report is rebuilt to exactly what the
// fold had built.
func TestDayRefold_Person_CountsEachRowForWhomTheFoldDoes(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil)

	const (
		day         = "2026-02-01"
		cs   uint64 = 41
		actr uint64 = 3
	)

	fold(t, svc,
		refoldLogRow(t, db, day, settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL, -sale, 48*time.Hour),
		refoldShopRow(t, db, day, cs, actr, settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL, -50_000),
		refoldShopRow(t, db, day, 0, actr, settlementv1.SettlementType_SETTLEMENT_TYPE_SYSTEM_ADJUSTMENT, 2_000),
	)

	folded := map[uint64]settlement_service_models.UserSettlementDailyReport{}
	for _, user := range []uint64{creator, cs, actr} {
		folded[user] = personRows(t, db, user)[day]
	}

	err := db.Exec(`DELETE FROM user_settlement_daily_reports WHERE day = DATE '2026-02-01'`).Error
	if err != nil {
		t.Fatal(err)
	}

	for user, want := range map[uint64]float64{creator: -sale, cs: -50_000, actr: 2_000} {
		result := refoldPerson(t, svc, user, day, false)
		if result.Counted != 1 || result.Claimed != 0 {
			t.Fatalf("user %d: result = %+v — one row of the day is theirs", user, result)
		}

		got := personRows(t, db, user)[day]
		if got.SettlementMetricColumns != folded[user].SettlementMetricColumns || got.Change != want {
			t.Fatalf("user %d = %+v, want the fold's %+v", user, got.SettlementMetricColumns, folded[user].SettlementMetricColumns)
		}
	}
}

// A LOST EVENT on the person report: counted, claimed, the later day's carry follows. The claim stops the redelivery,
// so the SHOP report is short now — and its re-fold counts the row.
func TestDayRefold_Person_ALostRowItClaimsIsCountedByTheShopRefold(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil)

	threeDays(t, db, svc)

	lost := refoldLogRow(t, db, "2026-01-02", settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER, -5_000, 3*time.Hour)

	person := refoldPerson(t, svc, creator, "2026-01-02", false)
	if person.Counted != 3 || person.Claimed != 1 || person.OtherReport != settlement_v1.ReportShopDaily ||
		len(person.Short) != 1 || person.Short[0] != shop {
		t.Fatalf("person re-fold = %+v — three rows, the lost one claimed, the shop report short", person)
	}

	rows := personRows(t, db, creator)
	if rows["2026-01-02"].Other != -5_000 || rows["2026-01-03"].OpenBalance != -95_000 || rows["2026-01-03"].CloseBalance != -35_000 {
		t.Fatalf("person days = %+v", rows)
	}

	if state := personState(t, db, creator); state.CloseBalance != -35_000 {
		t.Fatalf("person state close = %v", state.CloseBalance)
	}

	// The redelivery folds nothing — so the shop report is still short by the row.
	fold(t, svc, lost)

	if day := shopRows(t, db)["2026-01-02"]; day.Other != 0 || day.Change != 30_000 {
		t.Fatalf("shop 01-02 = %+v — the redelivery must fold nothing", day.SettlementMetricColumns)
	}

	if again := personRows(t, db, creator); again["2026-01-02"].SettlementMetricColumns != rows["2026-01-02"].SettlementMetricColumns {
		t.Fatal("the redelivery folded the person report again")
	}

	shopDay := refold(t, svc, "2026-01-02", false)
	if shopDay.Counted != 3 || shopDay.Claimed != 0 || !shopDay.Changed() || len(shopDay.Short) != 0 {
		t.Fatalf("shop re-fold = %+v — the claimed row counted, nothing new claimed", shopDay)
	}

	assertReportsAgree(t, db)
}

// THE OTHER DIRECTION: the shop re-fold claims a lost row, the person report stays short through its redelivery, and
// the person re-fold counts it.
func TestDayRefold_ALostRowTheShopRefoldClaimsIsCountedByThePersonRefold(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil)

	threeDays(t, db, svc)

	lost := refoldLogRow(t, db, "2026-01-02", settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER, -5_000, 3*time.Hour)

	shopDay := refold(t, svc, "2026-01-02", false)
	if shopDay.Claimed != 1 || len(shopDay.Short) != 1 || shopDay.Short[0] != creator {
		t.Fatalf("shop re-fold = %+v", shopDay)
	}

	fold(t, svc, lost)

	if day := personRows(t, db, creator)["2026-01-02"]; day.Other != 0 || day.Change != 30_000 {
		t.Fatalf("person 01-02 = %+v — short by the row, the redelivery folded nothing", day.SettlementMetricColumns)
	}

	person := refoldPerson(t, svc, creator, "2026-01-02", false)
	if person.Counted != 3 || person.Claimed != 0 || !person.Changed() || person.Teams[0].CarryDelta != -5_000 || person.Teams[0].LaterDays != 1 {
		t.Fatalf("person re-fold = %+v, teams %+v", person, person.Teams)
	}

	assertReportsAgree(t, db)

	if state := personState(t, db, creator); state.CloseBalance != -35_000 {
		t.Fatalf("person state close = %v, want −35.000", state.CloseBalance)
	}

	// Both repaired; neither moves again.
	if again := refold(t, svc, "2026-01-02", false); again.Changed() || again.Teams[0].CarryDelta != 0 {
		t.Fatalf("shop again = %+v", again)
	}

	if again := refoldPerson(t, svc, creator, "2026-01-02", false); again.Changed() || again.Teams[0].CarryDelta != 0 {
		t.Fatalf("person again = %+v", again)
	}
}

// assertReportsAgree: one shop and one person, so the two reports hold the same figures, day for day.
func assertReportsAgree(t *testing.T, db *gorm.DB) {
	t.Helper()

	shops, people := shopRows(t, db), personRows(t, db, creator)
	if len(shops) != len(people) {
		t.Fatalf("%d shop days, %d person days", len(shops), len(people))
	}

	for day, row := range shops {
		if people[day].SettlementMetricColumns != row.SettlementMetricColumns {
			t.Fatalf("%s: shop %+v, person %+v — the two reports disagree", day, row.SettlementMetricColumns, people[day].SettlementMetricColumns)
		}
	}

	if shopStateClose(t, db, shop) != personState(t, db, creator).CloseBalance {
		t.Fatal("the two state rows disagree")
	}
}

// AN EVENT IN FLIGHT is left to the fold on the person report too.
func TestDayRefold_Person_LeavesARowInFlightToTheFold(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil)

	threeDays(t, db, svc)

	young := refoldLogRow(t, db, "2026-01-03", settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 7_000, time.Minute)

	result := refoldPerson(t, svc, creator, "2026-01-03", false)
	if result.Counted != 1 || result.InFlight != 1 || result.Claimed != 0 || result.Changed() {
		t.Fatalf("result = %+v", result)
	}

	fold(t, svc, young)

	if day := personRows(t, db, creator)["2026-01-03"]; day.Fund != 67_000 {
		t.Fatalf("01-03 fund = %v, want 67.000", day.Fund)
	}
}

// A DRY RUN on the person report writes nothing.
func TestDayRefold_Person_ADryRunWritesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil)

	threeDays(t, db, svc)
	refoldLogRow(t, db, "2026-01-02", settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER, -5_000, 3*time.Hour)

	before := personRows(t, db, creator)

	result := refoldPerson(t, svc, creator, "2026-01-02", true)
	if !result.DryRun || !result.Changed() || result.Claimed != 1 || result.Teams[0].CarryDelta != -5_000 {
		t.Fatalf("dry run = %+v", result)
	}

	if after := personRows(t, db, creator); fmt.Sprint(after) != fmt.Sprint(before) {
		t.Fatal("the dry run wrote a row")
	}

	if state := personState(t, db, creator); state.CloseBalance != -30_000 {
		t.Fatalf("the dry run moved the state row: %v", state.CloseBalance)
	}
}

// A STRAY NEWEST DAY is removed and the person's `last_day` comes back down to the newest real row; a person left with
// no row at all reads 0 and no last day — off the person list, as after a replay's cut.
func TestDayRefold_Person_RemovesAStrayDayAndLowersTheLastDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil)

	threeDays(t, db, svc)

	const lonely uint64 = 99

	for _, statement := range []string{
		`INSERT INTO user_settlement_daily_reports (day, user_id, team_id, fund, change, open_balance, close_balance)
		 VALUES (DATE '2026-01-05', 7, 2, 9, 9, -30000, -29991)`,
		`UPDATE user_settlement_reports SET close_balance = -29991, last_day = DATE '2026-01-05' WHERE user_id = 7 AND team_id = 2`,
		`INSERT INTO user_settlement_daily_reports (day, user_id, team_id, fund, change, open_balance, close_balance)
		 VALUES (DATE '2026-01-05', 99, 2, 9, 9, 0, 9)`,
		`INSERT INTO user_settlement_reports (user_id, team_id, close_balance, last_day) VALUES (99, 2, 9, DATE '2026-01-05')`,
	} {
		err := db.Exec(statement).Error
		if err != nil {
			t.Fatal(err)
		}
	}

	result := refoldPerson(t, svc, creator, "2026-01-05", false)
	if len(result.Teams) != 1 || result.Teams[0].After != nil || result.Teams[0].Before == nil {
		t.Fatalf("result = %+v", result)
	}

	state := personState(t, db, creator)
	if state.CloseBalance != -30_000 || state.LastDay == nil || state.LastDay.Format(time.DateOnly) != "2026-01-03" {
		t.Fatalf("person state = %+v — close −30.000, last day back to 01-03", state)
	}

	refoldPerson(t, svc, lonely, "2026-01-05", false)

	if state := personState(t, db, lonely); state.CloseBalance != 0 || state.LastDay != nil {
		t.Fatalf("an emptied person = %+v — close 0, no last day", state)
	}
}

// THE RE-FOLD COMPARES WITH SAN_MONEY'S TOLERANCE, never == on a double (every-ledger-moves-to-double-rounded-when-frozen):
// a day row off from the log by float dust — below the 4 places money is compared at — holds the SAME figures, so the
// re-fold reports no change, writes nothing and shifts no later day. A real difference is still found and put back
// EXACTLY: a sum of whole-rupiah doubles is exact, so the rewritten row is == the log's.
func TestDayRefold_DustIsTheSameFigureAndARealDifferenceIsRestoredExactly(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil)

	threeDays(t, db, svc)

	good := shopRows(t, db)

	err := db.Exec(`UPDATE shop_settlement_daily_reports SET fund = fund + 0.00001, change = change + 0.00001,
		close_balance = close_balance + 0.00001 WHERE shop_id = ? AND team_id = ? AND day = DATE '2026-01-02'`, shop, team).Error
	if err != nil {
		t.Fatal(err)
	}

	versions := rowVersions(t, db, "shop_settlement_daily_reports", "shop_id", shop)

	dust := refold(t, svc, "2026-01-02", false)
	if dust.Changed() || len(dust.Teams) != 1 || dust.Teams[0].LaterDays != 0 {
		t.Fatalf("dust = %+v — below the tolerance it is the same figure: no change, no later day shifted", dust)
	}

	if now := rowVersions(t, db, "shop_settlement_daily_reports", "shop_id", shop); fmt.Sprint(now) != fmt.Sprint(versions) {
		t.Fatalf("the re-fold wrote rows over dust: %v, was %v", now, versions)
	}

	// A REAL DIFFERENCE — the wrong fold of the test above, over the dust — is rewritten to the log, exactly.
	wrongFold(t, db, "shop_settlement_daily_reports", "shop_settlement_reports", "shop_id", shop)

	real := refold(t, svc, "2026-01-02", false)
	if !real.Changed() || real.Teams[0].CarryDelta != 29_999 || real.Teams[0].LaterDays != 1 {
		t.Fatalf("a wrong day = %+v — rewritten, the later day shifted by exactly 29.999", real)
	}

	after := shopRows(t, db)
	if after["2026-01-02"].SettlementMetricColumns != good["2026-01-02"].SettlementMetricColumns {
		t.Fatalf("01-02 = %+v, want EXACTLY the log's %+v", after["2026-01-02"].SettlementMetricColumns, good["2026-01-02"].SettlementMetricColumns)
	}

	if after["2026-01-03"].SettlementMetricColumns != good["2026-01-03"].SettlementMetricColumns || shopStateClose(t, db, shop) != -30_000 {
		t.Fatalf("01-03 = %+v, state %v — the carry is back on the log's figures exactly", after["2026-01-03"].SettlementMetricColumns, shopStateClose(t, db, shop))
	}
}
