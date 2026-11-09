package expense_v1_test

import (
	"context"
	"maps"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// THE EXPENSE METRICS (metric_data.go, metric_fold.go) on the decisions' own example
// (an-expense-correction-counts-on-the-day-it-is-made, an-expense-correction-counts-for-who-made-it):
//
//	14 Oct  +500.000  ads, Toko Sinar, typed by Budi        → 14 Oct reads 500.000
//	16 Oct  +200.000  ads, Toko Sinar, typed by Budi        → 16 Oct reads 200.000
//	17 Oct  −200.000  Budi cancels the 16 Oct ad            → 17 Oct reads −200.000
//	20 Oct  −450.000  Dewi corrects the 14 Oct ad to 50.000 → 20 Oct reads −450.000, under Dewi
//
// beside Ani's ads on another shop, a payroll, a rent, an "other" with a fraction of a rupiah, and a stock loss that
// counts nowhere; Toko Kenanga's payroll (another seller); and Gudang Pusat's rent, typed by root (a warehouse team).

const (
	metricAds      = "metrics/ads"
	metricExpenses = "metrics/expenses"

	userAni  uint64 = 61
	userBudi uint64 = 62
	userDewi uint64 = 64
	userRoot uint64 = 1

	shopSinar uint64 = 16

	// Another selling team — Toko Kenanga.
	teamB uint64 = 3
)

// A Jakarta clock time, for a correction made then.
func wibAt(day string, hour int) time.Time {
	t, err := time.ParseInLocation("2006-01-02", day, time.FixedZone("WIB", 7*60*60))
	if err != nil {
		panic(err)
	}

	return t.Add(time.Duration(hour) * time.Hour)
}

type metricFixture struct {
	db  *gorm.DB
	svc *expense_v1.Service
	// The 14 Oct ad Dewi corrects.
	sinarAd uint64
}

// expenseAs records one expense as `user`, a member of `team` (root types as an override).
func expenseAs(
	t *testing.T,
	svc *expense_v1.Service,
	user, team uint64,
	kind expensev1.ExpenseKind,
	amount float64,
	on string,
	shop uint64,
) uint64 {
	t.Helper()

	role := role_basev1.Role_ROLE_SELLING_OWNER
	if user == userRoot {
		role = role_basev1.Role_ROLE_UNSPECIFIED
	}

	res, err := svc.ExpenseCreate(asCaller(user, team, role), connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId: team, Kind: kind, Amount: amount, OccurredAt: on, ShopId: shop, FinanceAccountId: payingAccount,
	}))
	if err != nil {
		t.Fatalf("ExpenseCreate(%v %v on %s by %d): %v", kind, amount, on, user, err)
	}

	return res.Msg.GetExpense().GetId()
}

// correctAs corrects an expense as `user`, on the Jakarta day and hour given.
func correctAs(t *testing.T, svc *expense_v1.Service, user, team, expenseID uint64, amount float64, at time.Time) {
	t.Helper()

	expense_v1.SetClock(svc, func() time.Time { return at })

	_, err := svc.ExpenseAdjust(asCaller(user, team, role_basev1.Role_ROLE_SELLING_OWNER), connect.NewRequest(&expensev1.ExpenseAdjustRequest{
		TeamId: team, ExpenseId: expenseID, Amount: amount, Note: "corrected",
	}))
	if err != nil {
		t.Fatalf("ExpenseAdjust(%d by %v at %v): %v", expenseID, amount, at, err)
	}
}

func metricBook(t *testing.T) *metricFixture {
	t.Helper()

	db := san_testdb.DB(t)
	svc := newService(t, db)

	ads := expensev1.ExpenseKind_EXPENSE_KIND_ADS

	sinarAd := expenseAs(t, svc, userBudi, teamA, ads, 500_000, "2026-10-14", shopSinar)
	cancelled := expenseAs(t, svc, userBudi, teamA, ads, 200_000, "2026-10-16", shopSinar)
	expenseAs(t, svc, userAni, teamA, ads, 100_000, "2026-10-15", adsShop)
	expenseAs(t, svc, userAni, teamA, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 7_500_000, "2026-10-31", 0)
	expenseAs(t, svc, userBudi, teamA, expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL, 2_500_000, "2026-10-01", 0)
	expenseAs(t, svc, userAni, teamA, expensev1.ExpenseKind_EXPENSE_KIND_OTHER, 120_000.5, "2026-10-10", 0)

	// A STOCK LOSS, as inventory records it (no interceptor, no account) — counted nowhere in Analytic.
	_, err := svc.ExpenseCreate(context.Background(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId: teamA, Kind: expensev1.ExpenseKind_EXPENSE_KIND_STOCK_LOSS, Amount: 90_000, OccurredAt: "2026-10-12",
	}))
	if err != nil {
		t.Fatalf("stock loss: %v", err)
	}

	correctAs(t, svc, userBudi, teamA, cancelled, -200_000, wibAt("2026-10-17", 10))
	correctAs(t, svc, userDewi, teamA, sinarAd, -450_000, wibAt("2026-10-20", 9))

	// Toko Kenanga's payroll, and Gudang Pusat's rent typed by root.
	expenseAs(t, svc, 68, teamB, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 4_000_000, "2026-10-31", 0)
	expenseAs(t, svc, userRoot, warehouseTeam, expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL, 3_000_000, "2026-10-01", 0)

	return &metricFixture{db: db, svc: svc, sinarAd: sinarAd}
}

func dateWindow(from, to string) *analytic_basev1.FilterItem {
	return &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_DateRangeFilter{
		DateRangeFilter: &analytic_basev1.DateRangeFilter{DateMin: from, DateMax: to},
	}}
}

func october() *analytic_basev1.FilterItem {
	return dateWindow("2026-10-01", "2026-10-31")
}

func idKeys(ids ...uint64) *analytic_basev1.MetricKeys {
	return &analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Ids{Ids: &analytic_basev1.IDList{Ids: ids}}}
}

func dayKeys(days ...string) *analytic_basev1.MetricKeys {
	return &analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: days}}}
}

// metricRead is one MetricData call as `team` reads it.
type metricRead struct {
	team      uint64
	group     analytic_basev1.GroupType
	rowsGroup analytic_basev1.GroupType
	filters   []*analytic_basev1.FilterItem
	keys      *analytic_basev1.MetricKeys
	metrics   []string
}

func (f *metricFixture) read(r metricRead) (*expensev1.MetricDataResponse, error) {
	if r.filters == nil {
		r.filters = []*analytic_basev1.FilterItem{october()}
	}

	res, err := f.svc.MetricData(context.Background(), connect.NewRequest(&expensev1.MetricDataRequest{
		TeamId: r.team, GroupBy: r.group, RowsGroup: r.rowsGroup, Filters: r.filters, Keys: r.keys, MetricIds: r.metrics,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

func (f *metricFixture) mustRead(t *testing.T, r metricRead) *expensev1.MetricDataResponse {
	t.Helper()

	res, err := f.read(r)
	if err != nil {
		t.Fatalf("MetricData(%+v): %v", r, err)
	}

	if len(res.GetMetricDatas()) != len(r.metrics) {
		t.Fatalf("%d answers for %d metrics", len(res.GetMetricDatas()), len(r.metrics))
	}

	return res
}

// adsByDay is Ads expense's amount per asked day.
func adsByDay(res *expensev1.MetricDataResponse, i int) map[string]float64 {
	out := map[string]float64{}
	for k, v := range res.GetMetricDatas()[i].GetAdsByDay().GetItems() {
		out[k] = v.GetAmount()
	}

	return out
}

func adsByID(res *expensev1.MetricDataResponse, i int) map[uint64]float64 {
	out := map[uint64]float64{}
	for k, v := range res.GetMetricDatas()[i].GetAdsById().GetItems() {
		out[k] = v.GetAmount()
	}

	return out
}

func sameFigures[K comparable](t *testing.T, what string, got, want map[K]float64) {
	t.Helper()

	if len(got) != len(want) {
		t.Fatalf("%s = %v, want %v", what, got, want)
	}

	for k, w := range want {
		g, ok := got[k]
		if !ok || !san_money.Equal(g, w) {
			t.Fatalf("%s = %v, want %v (key %v)", what, got, want, k)
		}
	}
}

// THE DECISION'S EXAMPLE, day by day: 14 Oct keeps its Rp 500.000; the −450.000 reads on 20 Oct, the day Dewi made it;
// the 16 Oct ad is taken back on the 17th, the cancel's day. Every asked day comes back, a quiet one at 0, and the week's
// headline nets Rp 50.000 — on Toko Sinar, the shop filter.
func TestMetricData_ACorrectionCountsOnTheDayItIsMade(t *testing.T) {
	f := metricBook(t)

	sinar := &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_ShopFilter{ShopFilter: &analytic_basev1.ShopFilter{ShopId: shopSinar}}}
	filters := []*analytic_basev1.FilterItem{dateWindow("2026-10-13", "2026-10-20"), sinar}

	days := []string{"2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"}

	res := f.mustRead(t, metricRead{
		team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_DAILY, filters: filters, keys: dayKeys(days...),
		metrics: []string{metricAds},
	})

	sameFigures(t, "Toko Sinar's ads by day", adsByDay(res, 0), map[string]float64{
		"2026-10-13": 0, "2026-10-14": 500_000, "2026-10-15": 0, "2026-10-16": 200_000,
		"2026-10-17": -200_000, "2026-10-18": 0, "2026-10-19": 0, "2026-10-20": -450_000,
	})

	headline := f.mustRead(t, metricRead{
		team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, filters: filters, metrics: []string{metricAds},
	})

	if got := headline.GetMetricDatas()[0].GetAdsSummary().GetAmount(); !san_money.Equal(got, 50_000) {
		t.Fatalf("the week's headline = %v, want 50.000", got)
	}

	// By month: October nets the corrections, September — before any of it — reads 0. Past periods never change.
	monthly := f.mustRead(t, metricRead{
		team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_MONTHLY,
		filters: []*analytic_basev1.FilterItem{dateWindow("2026-09-01", "2026-10-31"), sinar},
		keys:    dayKeys("2026-09-01", "2026-10-01"), metrics: []string{metricAds},
	})

	sameFigures(t, "Toko Sinar by month", adsByDay(monthly, 0), map[string]float64{"2026-09-01": 0, "2026-10-01": 50_000})

	// The Expenses page keeps the corrections on the expense's day: its 14 Oct reads the 50.000 left. Analytic alone
	// moved them (an-expense-posts-on-its-own-day is unchanged).
	var pageDay float64

	err := f.db.Model(&expense_service_models.ExpenseRecord{}).
		Select("COALESCE(SUM(amount), 0)").
		Where("team_id = ? AND occurred_at = ? AND shop_id = ?", teamA, "2026-10-14", shopSinar).
		Scan(&pageDay).
		Error
	if err != nil {
		t.Fatalf("the page's day: %v", err)
	}

	if !san_money.Equal(pageDay, 50_000) {
		t.Fatalf("the Expenses page's 14 Oct = %v, want 50.000 — the correction still on the expense's day there", pageDay)
	}
}

// CREATED BY COUNTS THE CORRECTOR (an-expense-correction-counts-for-who-made-it): Budi typed both Sinar ads and
// cancelled one — 500.000; Dewi only corrected, so she reads −450.000; Ani her own 100.000. A person with nothing reads 0.
func TestMetricData_CreatedByCountsTheCorrector(t *testing.T) {
	f := metricBook(t)

	res := f.mustRead(t, metricRead{
		team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_USER, keys: idKeys(userAni, userBudi, userDewi, 99),
		metrics: []string{metricAds},
	})

	sameFigures(t, "ads by who made each entry", adsByID(res, 0), map[uint64]float64{
		userAni: 100_000, userBudi: 500_000, userDewi: -450_000, 99: 0,
	})

	// Dewi's own days: −450.000 on the 20th, nothing on the 14th, which stays Budi's.
	dewi := &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_UserFilter{UserFilter: &analytic_basev1.UserFilter{UserId: userDewi}}}
	days := f.mustRead(t, metricRead{
		team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_DAILY, keys: dayKeys("2026-10-14", "2026-10-20"),
		filters: []*analytic_basev1.FilterItem{october(), dewi}, metrics: []string{metricAds},
	})

	sameFigures(t, "Dewi's ads by day", adsByDay(days, 0), map[string]float64{"2026-10-14": 0, "2026-10-20": -450_000})
}

// EXPENSES BY KIND: a field per typed kind and their total, exact to the fraction (the-backend-never-rounds-money); the
// stock loss in none of them (stock-loss-stays-out-of-analytic-expenses). Asked with Ads expense, one call answers both,
// in the asked order, and Ads expense's amount IS Expenses' ads.
func TestMetricData_ExpensesByKindAndTotal(t *testing.T) {
	f := metricBook(t)

	res := f.mustRead(t, metricRead{
		team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, metrics: []string{metricExpenses, metricAds},
	})

	e := res.GetMetricDatas()[0].GetExpensesSummary()
	ads := res.GetMetricDatas()[1].GetAdsSummary()

	sameFigures(t, "October by kind", map[string]float64{
		"ads": e.GetAds(), "payroll": e.GetPayroll(), "operational": e.GetOperational(), "other": e.GetOther(), "total": e.GetTotal(),
	}, map[string]float64{
		"ads": 150_000, "payroll": 7_500_000, "operational": 2_500_000, "other": 120_000.5, "total": 10_270_000.5,
	})

	if e.GetTotal() != 10_270_000.5 {
		t.Fatalf("the total = %v, want exactly 10.270.000,5 — never rounded", e.GetTotal())
	}

	if ads.GetAmount() != e.GetAds() {
		t.Fatalf("Ads expense = %v, Expenses' ads = %v — one figure, read twice", ads.GetAmount(), e.GetAds())
	}

	// By month, the same figures under October's key.
	monthly := f.mustRead(t, metricRead{
		team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_MONTHLY, keys: dayKeys("2026-10-01"),
		metrics: []string{metricExpenses},
	})

	if got := monthly.GetMetricDatas()[0].GetExpensesByDay().GetItems()["2026-10-01"].GetTotal(); got != e.GetTotal() {
		t.Fatalf("October's row = %v, the headline %v", got, e.GetTotal())
	}
}

// A STOCK LOSS COUNTS NOWHERE (stock-loss-stays-out-of-analytic-expenses): it writes no report row, nor does a
// correction of one — the table holds only typed kinds.
func TestMetricData_AStockLossIsNeverCounted(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	res, err := svc.ExpenseCreate(context.Background(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId: teamA, Kind: expensev1.ExpenseKind_EXPENSE_KIND_STOCK_LOSS, Amount: 45_000.25, OccurredAt: "2026-10-12",
	}))
	if err != nil {
		t.Fatalf("stock loss: %v", err)
	}

	correctAs(t, svc, userBudi, teamA, res.Msg.GetExpense().GetId(), -5_000, wibAt("2026-10-13", 8))

	var rows int64

	err = db.Model(&expense_service_models.ExpenseMetricDailyReport{}).Count(&rows).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if rows != 0 {
		t.Fatalf("%d report rows for a stock loss and its correction, want none", rows)
	}

	// The table refuses one outright.
	err = db.Exec(`SAVEPOINT stock_loss`).Error
	if err != nil {
		t.Fatalf("savepoint: %v", err)
	}

	err = db.Exec(`INSERT INTO expense_metric_daily_reports (day, team_id, kind, amount) VALUES ('2026-10-12', 2, 5, 1)`).Error
	if err == nil {
		t.Fatalf("the table took a STOCK_LOSS row")
	}

	db.Exec(`ROLLBACK TO SAVEPOINT stock_loss`)
}

// A WAREHOUSE TEAM'S EXPENSES SIT UNDER WAREHOUSE (the-warehouse-is-its-own-group): Gudang Pusat reads its own rent by
// Warehouse; by Seller it is no row. A seller is never a Warehouse key.
func TestMetricData_AWarehouseTeamsExpensesSitUnderWarehouse(t *testing.T) {
	f := metricBook(t)

	byWarehouse := f.mustRead(t, metricRead{
		team: warehouseTeam, group: analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE, keys: idKeys(warehouseTeam, teamA),
		metrics: []string{metricExpenses},
	})

	items := byWarehouse.GetMetricDatas()[0].GetExpensesById().GetItems()
	if got := items[warehouseTeam].GetOperational(); got != 3_000_000 || items[warehouseTeam].GetTotal() != 3_000_000 {
		t.Fatalf("Gudang Pusat by warehouse = %v, want its 3.000.000 rent", items[warehouseTeam])
	}

	if items[teamA].GetTotal() != 0 {
		t.Fatalf("Toko Melati as a warehouse key = %v, want 0 — it is a seller", items[teamA])
	}

	bySeller := f.mustRead(t, metricRead{
		team: warehouseTeam, group: analytic_basev1.GroupType_GROUP_TYPE_TEAM, keys: idKeys(warehouseTeam),
		metrics: []string{metricExpenses},
	})

	if got := bySeller.GetMetricDatas()[0].GetExpensesById().GetItems()[warehouseTeam].GetTotal(); got != 0 {
		t.Fatalf("Gudang Pusat as a seller = %v, want 0 — a warehouse is no Seller row", got)
	}
}

// THE HEADLINE EQUALS THE ROWS (the-expense-prototype-is-accepted) — root reads every team's. By Seller its headline
// is the two sellers' only, by Warehouse the warehouse's only, and ungrouped every expense it can see.
func TestMetricData_TheHeadlineCountsOnlyTheGroupsRows(t *testing.T) {
	f := metricBook(t)

	headline := func(rows analytic_basev1.GroupType) float64 {
		res := f.mustRead(t, metricRead{
			team: 1, group: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, rowsGroup: rows, metrics: []string{metricExpenses},
		})

		return res.GetMetricDatas()[0].GetExpensesSummary().GetTotal()
	}

	sellers := f.mustRead(t, metricRead{
		team: 1, group: analytic_basev1.GroupType_GROUP_TYPE_TEAM, keys: idKeys(teamA, teamB), metrics: []string{metricExpenses},
	})
	items := sellers.GetMetricDatas()[0].GetExpensesById().GetItems()
	rowsSum := items[teamA].GetTotal() + items[teamB].GetTotal()

	if !san_money.Equal(items[teamA].GetTotal(), 10_270_000.5) || items[teamB].GetTotal() != 4_000_000 {
		t.Fatalf("root by seller = Melati %v, Kenanga %v", items[teamA].GetTotal(), items[teamB].GetTotal())
	}

	for _, c := range []struct {
		name string
		rows analytic_basev1.GroupType
		want float64
	}{
		{"by Seller", analytic_basev1.GroupType_GROUP_TYPE_TEAM, rowsSum},
		{"by Warehouse", analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE, 3_000_000},
		{"ungrouped", analytic_basev1.GroupType_GROUP_TYPE_UNSPECIFIED, rowsSum + 3_000_000},
		{"by month", analytic_basev1.GroupType_GROUP_TYPE_MONTHLY, rowsSum + 3_000_000},
	} {
		if got := headline(c.rows); !san_money.Equal(got, c.want) {
			t.Fatalf("root's headline %s = %v, want %v", c.name, got, c.want)
		}
	}
}

// EVERY TEAM READS ITS OWN, ROOT EVERY TEAM'S (every-member-reads-every-metric-of-their-team,
// the-expense-metrics-follow-the-decisions-already-made): Toko Kenanga reads its payroll and none of Toko Melati's; a
// seller filter naming another team reads nothing; root reads both.
func TestMetricData_EveryTeamReadsItsOwnRootEveryTeams(t *testing.T) {
	f := metricBook(t)

	total := func(team uint64, filters ...*analytic_basev1.FilterItem) float64 {
		res := f.mustRead(t, metricRead{
			team: team, group: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, filters: append([]*analytic_basev1.FilterItem{october()}, filters...),
			metrics: []string{metricExpenses},
		})

		return res.GetMetricDatas()[0].GetExpensesSummary().GetTotal()
	}

	seller := func(id uint64) *analytic_basev1.FilterItem {
		return &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_TeamFilter{TeamFilter: &analytic_basev1.TeamFilter{TeamId: id}}}
	}

	if got := total(teamB); got != 4_000_000 {
		t.Fatalf("Kenanga reads %v, want its own 4.000.000", got)
	}

	if got := total(teamB, seller(teamA)); got != 0 {
		t.Fatalf("Kenanga filtering to Melati reads %v, want nothing", got)
	}

	if got := total(1, seller(teamA)); !san_money.Equal(got, 10_270_000.5) {
		t.Fatalf("root filtering to Melati reads %v", got)
	}

	if got := total(1, seller(teamB)); got != 4_000_000 {
		t.Fatalf("root filtering to Kenanga reads %v", got)
	}
}

// WHO MAY READ: every member of a selling team — CS included, unlike ExpenseList — and of a warehouse
// (every-member-reads-every-metric-of-their-team); root and the administrator.
func TestMetricData_EveryMemberMayRead(t *testing.T) {
	for _, name := range []string{"warehouse.expense.v1.MetricDataRequest", "warehouse.expense.v1.MetricSearchRequest"} {
		roles := policyRoles(t, name)

		for _, role := range []role_basev1.Role{
			role_basev1.Role_ROLE_ROOT, role_basev1.Role_ROLE_ADMINISTRATOR,
			role_basev1.Role_ROLE_SELLING_OWNER, role_basev1.Role_ROLE_SELLING_ADMIN, role_basev1.Role_ROLE_SELLING_CS,
			role_basev1.Role_ROLE_WAREHOUSE_OWNER, role_basev1.Role_ROLE_WAREHOUSE_ADMIN, role_basev1.Role_ROLE_WAREHOUSE_STAFF,
		} {
			if !roles[role] {
				t.Fatalf("%s does not admit %s", name, role)
			}
		}
	}
}

// What a read refuses, as InvalidArgument: a metric this service does not serve, a shop filter on Expenses (only an
// ads expense names one), a group a metric cannot be read by, rows_group on a grouped read, keys under SUMMARY, a period
// keyed by any day but its first, no date range.
func TestMetricData_Refuses(t *testing.T) {
	f := metricBook(t)

	shop := &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_ShopFilter{ShopFilter: &analytic_basev1.ShopFilter{ShopId: shopSinar}}}

	for _, c := range []struct {
		name string
		read metricRead
	}{
		{"another service's metric", metricRead{team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, metrics: []string{"metrics/inventory/lost"}}},
		{"a shop on Expenses", metricRead{
			team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, filters: []*analytic_basev1.FilterItem{october(), shop},
			metrics: []string{metricAds, metricExpenses},
		}},
		{"Expenses by shop", metricRead{
			team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_SHOP, keys: idKeys(shopSinar), metrics: []string{metricExpenses},
		}},
		{"a headline by shop for Expenses", metricRead{
			team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, rowsGroup: analytic_basev1.GroupType_GROUP_TYPE_SHOP,
			metrics: []string{metricExpenses},
		}},
		{"rows_group on a grouped read", metricRead{
			team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_TEAM, rowsGroup: analytic_basev1.GroupType_GROUP_TYPE_TEAM,
			keys: idKeys(teamA), metrics: []string{metricExpenses},
		}},
		{"keys under SUMMARY", metricRead{
			team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, keys: idKeys(teamA), metrics: []string{metricAds},
		}},
		{"a month keyed by its 15th", metricRead{
			team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_MONTHLY, keys: dayKeys("2026-10-15"), metrics: []string{metricAds},
		}},
		{"no date range", metricRead{
			team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, filters: []*analytic_basev1.FilterItem{}, metrics: []string{metricAds},
		}},
	} {
		_, err := f.read(c.read)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("%s: %v, want InvalidArgument", c.name, err)
		}
	}
}

// Every asked key comes back — never missing, a quiet one all zero (the-fill-step-scopes-its-numbers-by-the-filters).
func TestMetricData_EveryAskedKeyComesBack(t *testing.T) {
	f := metricBook(t)

	res := f.mustRead(t, metricRead{
		team: teamA, group: analytic_basev1.GroupType_GROUP_TYPE_SHOP, keys: idKeys(shopSinar, adsShop, 404),
		metrics: []string{metricAds},
	})

	got := adsByID(res, 0)
	if keys := slices.Sorted(maps.Keys(got)); !slices.Equal(keys, []uint64{shopSinar, adsShop, 404}) {
		t.Fatalf("keys = %v, want every asked one", keys)
	}

	sameFigures(t, "ads by shop", got, map[uint64]float64{shopSinar: 50_000, adsShop: 100_000, 404: 0})
}
