package expense_v1_test

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// THE EXPENSE METRICS' DAY RE-FOLD (metric_refold.go, `san report refold --report expense-daily`): a team's day rebuilt
// from its `expense_records` through the fold's own key — the repair for the rows expense 00009 left untyped.

// reportRows is a team's report as text, one line per row — its key, side and amount — sorted, for an exact compare.
func refoldReportRows(t *testing.T, db *gorm.DB, team uint64) []string {
	t.Helper()

	var rows []expense_service_models.ExpenseMetricDailyReport

	err := db.
		Where("team_id = ?", team).
		Find(&rows).
		Error
	if err != nil {
		t.Fatalf("read the report: %v", err)
	}

	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, fmt.Sprintf("%s kind %d flow %d type %d shop %d user %d seller %d warehouse %d = %s",
			r.Day.Format("2006-01-02"), r.Kind, r.Flow, r.Type, r.ShopID, r.UserID, r.SellerID, r.WarehouseID,
			san_money.Text(r.Amount)))
	}

	slices.Sort(out)

	return out
}

func refold(t *testing.T, svc *expense_v1.Service, team uint64, day string, dry bool) expense_v1.MetricDayRefoldResult {
	t.Helper()

	res, err := svc.MetricDayRefold(context.Background(), expense_v1.MetricDayRefoldInput{TeamID: team, Day: day, DryRun: dry})
	if err != nil {
		t.Fatalf("MetricDayRefold(%d, %s): %v", team, day, err)
	}

	return res
}

// REFOLD = FOLD. A month of every kind of entry through the real writers — types of every flow, an expense corrected
// and one cancelled on later days, the corrector another person, a fraction of a rupiah, a stock loss (counted
// nowhere), a warehouse team's rent — folded as they were written. Every report row of both teams deleted and each day
// re-folded: the report is row for row what the fold wrote. A second re-fold changes nothing.
func TestMetricDayRefold_EqualsTheFold(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	typedAs(t, svc, userAni, teamA, tElectricity, 255_000.5, "2026-11-03")
	typedAs(t, svc, userBudi, teamA, tElectricity, 100_000, "2026-11-03")
	typedAs(t, svc, userAni, teamA, tReceivable, 350_000, "2026-11-03")
	typedAs(t, svc, userAni, teamA, tPrive, 2_000_000, "2026-11-04")
	typedAs(t, svc, userAni, teamA, tDeposit, 1_000_000, "2026-11-04")
	ad := typed(t, svc, teamA, tMarketplace, 500_000, "2026-11-04", payingAccount)
	bonus := typed(t, svc, teamA, tBonus, 600_000, "2026-11-05", payingAccount)
	typedAs(t, svc, userRoot, warehouseTeam, tKitchen, 213_000, "2026-11-05")

	// A stock loss, as inventory records it.
	stockLoss(t, svc, "2026-11-05")

	expense_v1.SetClock(svc, func() time.Time { return wibAt("2026-11-07", 23) })
	correct(t, svc, teamA, ad.GetId(), -450_000)
	correct(t, svc, teamA, bonus.GetId(), -600_000)

	folded := map[uint64][]string{teamA: refoldReportRows(t, db, teamA), warehouseTeam: refoldReportRows(t, db, warehouseTeam)}
	if len(folded[teamA]) < 8 || len(folded[warehouseTeam]) != 1 {
		t.Fatalf("the fold wrote %d + %d rows — the fixture is not what this test thinks", len(folded[teamA]),
			len(folded[warehouseTeam]))
	}

	err := db.Where("team_id IN ?", []uint64{teamA, warehouseTeam}).Delete(&expense_service_models.ExpenseMetricDailyReport{}).Error
	if err != nil {
		t.Fatal(err)
	}

	for team, days := range map[uint64][]string{
		teamA:         {"2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"},
		warehouseTeam: {"2026-11-05"},
	} {
		for _, day := range days {
			refold(t, svc, team, day, false)
		}

		if got := refoldReportRows(t, db, team); !slices.Equal(got, folded[team]) {
			t.Fatalf("team %d re-folded:\n%s\nfolded:\n%s", team, strings.Join(got, "\n"), strings.Join(folded[team], "\n"))
		}

		for _, day := range days {
			if again := refold(t, svc, team, day, false); again.Changed() {
				t.Fatalf("team %d, %s: a second re-fold changed %+v", team, day, again.Rows)
			}
		}
	}
}

// stockLoss records a STOCK_LOSS as inventory does — no interceptor, no account, no type.
func stockLoss(t *testing.T, svc *expense_v1.Service, on string) {
	t.Helper()

	kind := expensev1.ExpenseKind_EXPENSE_KIND_STOCK_LOSS

	_, err := svc.ExpenseCreate(context.Background(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId: teamA, Kind: kind, Type: typeFor(kind), Amount: 90_000, OccurredAt: on,
	}))
	if err != nil {
		t.Fatalf("stock loss: %v", err)
	}
}

// OLD ROWS GET THEIR TYPES. Three typed expenses whose report rows sit as expense 00009 left the older ones (type 0):
// Analytic shows their groups and total but no type. The dry run lists the rows it would move and writes nothing; the
// real run puts each under its type — the groups and the total unmoved, the type fields filled — and a second run
// changes nothing.
func TestMetricDayRefold_GivesOldRowsTheirTypes(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const day = "2026-11-10"

	typedAs(t, svc, userAni, teamA, tBonus, 600_000, day)
	typedAs(t, svc, userAni, teamA, tElectricity, 255_000, day)
	typedAs(t, svc, userAni, teamA, tReceivable, 350_000, day)

	err := db.Exec(`UPDATE expense_metric_daily_reports SET type = 0 WHERE team_id = ?`, teamA).Error
	if err != nil {
		t.Fatal(err)
	}

	before := expensesOnDay(t, svc, teamA, day)
	for typ, v := range typeFigures(t, before) {
		if v != 0 {
			t.Fatalf("an untyped row shows under %v (%v)", typ, v)
		}
	}

	old := refoldReportRows(t, db, teamA)

	dry := refold(t, svc, teamA, day, true)
	if !dry.Changed() || !dry.DryRun || dry.Counted != 3 || len(dry.Rows) != 6 {
		t.Fatalf("dry run = %+v — want 3 untyped rows out and 3 typed in, from 3 records", dry)
	}

	if got := refoldReportRows(t, db, teamA); !slices.Equal(got, old) {
		t.Fatalf("the dry run wrote:\n%s", strings.Join(got, "\n"))
	}

	done := refold(t, svc, teamA, day, false)
	if !done.Changed() || done.DryRun {
		t.Fatalf("real run = %+v", done)
	}

	after := expensesOnDay(t, svc, teamA, day)
	figures := typeFigures(t, after)

	if !san_money.Equal(figures[tBonus], 600_000) || !san_money.Equal(figures[tElectricity], 255_000) ||
		!san_money.Equal(figures[tReceivable], -350_000) {
		t.Fatalf("after the re-fold: bonus %v, electricity %v, receivable %v", figures[tBonus], figures[tElectricity],
			figures[tReceivable])
	}

	sameFigures(t, "the fields the types do not move", map[string]float64{
		"payroll": after.GetPayroll(), "operational": after.GetOperational(), "money_in": after.GetMoneyIn(),
		"total": after.GetTotal(),
	}, map[string]float64{
		"payroll": before.GetPayroll(), "operational": before.GetOperational(), "money_in": before.GetMoneyIn(),
		"total": before.GetTotal(),
	})

	if again := refold(t, svc, teamA, day, false); again.Changed() {
		t.Fatalf("a second run changed %+v", again.Rows)
	}
}

// The re-fold names one team and one Jakarta day.
func TestMetricDayRefold_Refuses(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.MetricDayRefold(context.Background(), expense_v1.MetricDayRefoldInput{Day: "2026-11-10"})
	if err == nil || !strings.Contains(err.Error(), "a team id is required") {
		t.Fatalf("no team: %v", err)
	}

	_, err = svc.MetricDayRefold(context.Background(), expense_v1.MetricDayRefoldInput{TeamID: teamA, Day: "2026-02-31"})
	if err == nil || !strings.Contains(err.Error(), "--date") {
		t.Fatalf("not a day: %v", err)
	}
}
