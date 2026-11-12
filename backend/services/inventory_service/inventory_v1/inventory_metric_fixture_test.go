package inventory_v1_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE FOUR INVENTORY METRICS' TEST KIT — a reader in a role, a day on the stock transaction's clock, a window, one
// MetricData / MetricSearch call, and the ledger-vs-report check every writer's test ends with.

const (
	restockMetricID  = "metrics/inventory/restock"
	transferMetricID = "metrics/inventory/transfer"
	returnMetricID   = "metrics/inventory/return"
	readyMetricID    = "metrics/inventory/ready"
)

var metricWIB = time.FixedZone("WIB", 7*60*60)

// asRole is a member of the scoped team in a role — what the policy interceptor puts in ctx.
func asRole(user uint64, role role_basev1.Role) context.Context {
	return san_auth.WithCallerRole(ctxUser(user), role)
}

// daysAgo is noon (Jakarta) `n` days before today — a stock transaction's clock through inventory_ledgers.WithNow.
func daysAgo(n int) time.Time {
	now := time.Now().In(metricWIB)

	return time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, metricWIB).AddDate(0, 0, -n)
}

// dayOf is `n` days ago as a key, YYYY-MM-DD.
func dayOf(n int) string {
	return daysAgo(n).Format("2006-01-02")
}

// on runs a stock change `n` days ago — its report rows and log rows land on that day.
func on(ctx context.Context, n int) context.Context {
	return inventory_ledgers.WithNow(ctx, daysAgo(n))
}

func windowOf(from, to string) *analytic_basev1.FilterItem {
	return &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_DateRangeFilter{
		DateRangeFilter: &analytic_basev1.DateRangeFilter{DateMin: from, DateMax: to},
	}}
}

// lastWeek is the window every metric test reads unless it says otherwise: a week ago to today.
func lastWeek() *analytic_basev1.FilterItem {
	return windowOf(dayOf(7), dayOf(0))
}

func dayKeys(days ...string) *analytic_basev1.MetricKeys {
	return &analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: days}}}
}

func warehouseFilter(id uint64) *analytic_basev1.FilterItem {
	return &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_WarehouseFilter{
		WarehouseFilter: &analytic_basev1.WarehouseFilter{WarehouseId: id},
	}}
}

func supplierFilter(id uint64) *analytic_basev1.FilterItem {
	return &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_SupplierFilter{
		SupplierFilter: &analytic_basev1.SupplierFilter{SupplierId: id},
	}}
}

// readMetric is one MetricData call for one metric; the filters default to lastWeek.
func readMetric(
	svc *inventory_v1.Service,
	ctx context.Context,
	team uint64,
	metricID string,
	group analytic_basev1.GroupType,
	keys *analytic_basev1.MetricKeys,
	filters ...*analytic_basev1.FilterItem,
) (*inventoryv1.MetricData, error) {
	if len(filters) == 0 {
		filters = []*analytic_basev1.FilterItem{lastWeek()}
	}

	res, err := svc.MetricData(ctx, connect.NewRequest(&inventoryv1.MetricDataRequest{
		TeamId: team, GroupBy: group, Filters: filters, Keys: keys, MetricIds: []string{metricID},
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetMetricDatas()[0], nil
}

func mustRead(
	t *testing.T,
	svc *inventory_v1.Service,
	ctx context.Context,
	team uint64,
	metricID string,
	group analytic_basev1.GroupType,
	keys *analytic_basev1.MetricKeys,
	filters ...*analytic_basev1.FilterItem,
) *inventoryv1.MetricData {
	t.Helper()

	data, err := readMetric(svc, ctx, team, metricID, group, keys, filters...)
	if err != nil {
		t.Fatalf("%s %s as team %d: %v", metricID, group, team, err)
	}

	return data
}

// searchMetric is one MetricSearch call over lastWeek unless filters say otherwise.
func searchMetric(
	svc *inventory_v1.Service,
	ctx context.Context,
	team uint64,
	metricID string,
	group analytic_basev1.GroupType,
	field string,
	order analytic_basev1.SortType,
	offset, limit int32,
	filters ...*analytic_basev1.FilterItem,
) (*inventoryv1.MetricSearchResponse, error) {
	if len(filters) == 0 {
		filters = []*analytic_basev1.FilterItem{lastWeek()}
	}

	res, err := svc.MetricSearch(ctx, connect.NewRequest(&inventoryv1.MetricSearchRequest{
		TeamId: team, GroupBy: group, Filters: filters,
		Sort: &analytic_basev1.MetricSort{MetricId: metricID, Field: field, SortType: order},
		Page: &analytic_basev1.PaginationFilter{Offset: offset, Limit: limit},
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// ledgerMatchesReport is THE COMPLETENESS CHECK (ready-stock-is-folded-in-the-stock-changes-own-step: "no change can be
// missed"): Σ batch_logs per Jakarta day × warehouse × owner × product × supplier × change type equals the
// inventory_stock_daily_changes row of that key — every key on both sides, to 4 places. Limited to `types` when a
// fixture renamed batches behind the ledger's back (an UPDATE of supplier_id after their restock). Returns how many keys
// it compared, so a test can say it compared something.
func ledgerMatchesReport(t *testing.T, db *gorm.DB, types ...string) int {
	t.Helper()

	logWhere, reportWhere := "TRUE", "TRUE"

	var args []any

	if len(types) > 0 {
		logWhere = "l.change_type IN ?"
		reportWhere = "change_type IN ?"
		args = []any{types, types}
	}

	var check struct {
		Keys       int
		Mismatched int
		Example    string
	}

	err := db.Raw(`
WITH l AS (
    SELECT (l.created_at AT TIME ZONE 'Asia/Jakarta')::date AS day, l.warehouse_id, l.team_id, b.product_id,
           b.supplier_id, l.change_type, SUM(l.change_count) AS n, SUM(l.change_valuation) AS v
    FROM batch_logs l JOIN batches b ON b.id = l.batch_id
    WHERE `+logWhere+`
    GROUP BY 1, 2, 3, 4, 5, 6
),
r AS (
    SELECT day, warehouse_id, team_id, product_id, supplier_id, change_type, change_count AS n, change_value AS v
    FROM inventory_stock_daily_changes
    WHERE `+reportWhere+`
),
j AS (
    SELECT day, warehouse_id, team_id, product_id, supplier_id, change_type,
           COALESCE(l.n, 0) AS ln, COALESCE(r.n, 0) AS rn, COALESCE(l.v, 0) AS lv, COALESCE(r.v, 0) AS rv
    FROM l FULL JOIN r USING (day, warehouse_id, team_id, product_id, supplier_id, change_type)
)
SELECT count(*) AS keys,
       count(*) FILTER (WHERE ln <> rn OR abs(lv - rv) >= 0.0001) AS mismatched,
       COALESCE(string_agg(CASE WHEN ln <> rn OR abs(lv - rv) >= 0.0001
           THEN format('%s w%s t%s p%s s%s %s: ledger %s/%s report %s/%s', day, warehouse_id, team_id, product_id,
                       supplier_id, change_type, ln, lv, rn, rv) END, '; '), '') AS example
FROM j`, args...).Scan(&check).Error
	if err != nil {
		t.Fatalf("ledger vs report: %v", err)
	}

	if check.Mismatched != 0 {
		t.Fatalf("the report disagrees with the ledger on %d of %d keys: %s", check.Mismatched, check.Keys,
			strings.TrimSpace(check.Example))
	}

	return check.Keys
}

// reportTypes is the change types the report holds rows of today-or-any-day, for "this writer folded" asserts.
func reportTypes(t *testing.T, db *gorm.DB) map[string]bool {
	t.Helper()

	var types []string

	err := db.Raw(`SELECT DISTINCT change_type FROM inventory_stock_daily_changes`).Scan(&types).Error
	if err != nil {
		t.Fatalf("report types: %v", err)
	}

	out := map[string]bool{}
	for _, ty := range types {
		out[ty] = true
	}

	return out
}
