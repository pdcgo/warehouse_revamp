package expense_v1

import (
	"errors"
	"fmt"
	"slices"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1/expensev1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_metric"
)

// THE EXPENSE METRICS — `metrics/ads` (Ads expense) and `metrics/expenses` (Expenses) on the Analytic composer
// (docs/business/analytic/rpc_provide_decision.md — expense-has-ads-and-expenses, stock-loss-stays-out-of-analytic-expenses,
// the-expense-metrics-follow-the-decisions-already-made, the-expense-prototype-is-accepted), read from
// `expense_metric_daily_reports`, which foldMetric writes in the expense row's own transaction.

var _ expensev1connect.ExpenseAnalyticServiceHandler = (*Service)(nil)

// expenseMetric is one of the two metrics this service serves, read off its message so the id, the filters and the
// groups are stated once, in the proto.
type expenseMetric struct {
	descriptor protoreflect.MessageDescriptor
	option     *analytic_basev1.MetricOption
	// Ads expense counts the ADS kind only; Expenses every typed kind.
	adsOnly bool
}

var (
	adsMetric = expenseMetric{
		descriptor: (&expensev1.AdsExpenseMetric{}).ProtoReflect().Descriptor(),
		option:     san_metric.OptionOf((&expensev1.AdsExpenseMetric{}).ProtoReflect().Descriptor()),
		adsOnly:    true,
	}
	expensesMetric = expenseMetric{
		descriptor: (&expensev1.ExpensesMetric{}).ProtoReflect().Descriptor(),
		option:     san_metric.OptionOf((&expensev1.ExpensesMetric{}).ProtoReflect().Descriptor()),
	}
)

func (m expenseMetric) id() string {
	return m.option.GetMetricId()
}

// metricColumn is a sortable field's column in the sums every grouped read selects — the field's own name, except Ads
// expense's `amount`, which is the ADS kind's sum.
func (m expenseMetric) metricColumn(field string) string {
	if m.adsOnly {
		return "ads"
	}

	return field
}

var errMetricRangeBackwards = errors.New("date_min must not be after date_max")

func invalidMetric(format string, args ...any) error {
	return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf(format, args...))
}

func metricDBError(err error) error {
	return connect.NewError(connect.CodeInternal, err)
}

// metricOf reads a metric id this service serves; any other is InvalidArgument.
func metricOf(id string) (expenseMetric, error) {
	switch id {
	case adsMetric.id():
		return adsMetric, nil
	case expensesMetric.id():
		return expensesMetric, nil
	default:
		return expenseMetric{}, invalidMetric("this service does not serve %q", id)
	}
}

// metricReader is WHO reads: every member of a team its own team's expenses, CS included
// (every-member-reads-every-metric-of-their-team); the root team every team's (the-expense-metrics-follow-the-decisions-
// already-made). Any other team's expense matches no row.
type metricReader struct {
	all    bool
	teamID uint64
}

func metricReaderOf(teamID uint64) metricReader {
	return metricReader{all: teamID == san_auth.RootTeamID, teamID: teamID}
}

// metricFilters is what the filters narrow the figures to — each a dimension, never the scope.
type metricFilters struct {
	start, end time.Time
	sellerID   uint64 // TEAM — the seller (the-team-group-is-the-seller)
	shopID     uint64 // SHOP — Ads expense only
	userID     uint64 // USER — who made the entry
}

// parseMetricFilters reads a request's filters for the asked metrics. Each case's field number IS its FilterType
// (a-filter-names-one-id-and-shares-its-types-number). A filter one of the metrics does not support (a shop for
// Expenses — a-new-metric-removes-the-filters-it-cannot-use), a repeated one, or a missing date range is InvalidArgument.
func parseMetricFilters(metrics []expenseMetric, items []*analytic_basev1.FilterItem) (metricFilters, error) {
	var filters metricFilters

	seen := map[analytic_basev1.FilterType]bool{}

	for _, item := range items {
		reflected := item.ProtoReflect()

		set := reflected.WhichOneof(reflected.Descriptor().Oneofs().ByName("f"))
		if set == nil {
			return filters, invalidMetric("a filter item carries no filter")
		}

		kind := analytic_basev1.FilterType(set.Number())

		for _, m := range metrics {
			if !slices.Contains(m.option.GetSupportedFilters(), kind) {
				return filters, invalidMetric("%s does not support %s", m.id(), kind)
			}
		}

		if seen[kind] {
			return filters, invalidMetric("%s is sent twice", kind)
		}

		seen[kind] = true

		switch kind {
		case analytic_basev1.FilterType_FILTER_TYPE_DATE_RANGE:
			window := item.GetDateRangeFilter()

			start, err := time.Parse(dateLayout, window.GetDateMin())
			if err != nil {
				return filters, invalidMetric("date_min is not a day: %q", window.GetDateMin())
			}

			end, err := time.Parse(dateLayout, window.GetDateMax())
			if err != nil {
				return filters, invalidMetric("date_max is not a day: %q", window.GetDateMax())
			}

			if start.After(end) {
				return filters, connect.NewError(connect.CodeInvalidArgument, errMetricRangeBackwards)
			}

			// A YEAR AT MOST, both days counted (a-metric-reads-at-most-a-year).
			err = san_metric.CheckRange(start, end)
			if err != nil {
				return filters, connect.NewError(connect.CodeInvalidArgument, err)
			}

			filters.start, filters.end = start, end
		case analytic_basev1.FilterType_FILTER_TYPE_TEAM:
			filters.sellerID = item.GetTeamFilter().GetTeamId()
		case analytic_basev1.FilterType_FILTER_TYPE_SHOP:
			filters.shopID = item.GetShopFilter().GetShopId()
		case analytic_basev1.FilterType_FILTER_TYPE_USER:
			filters.userID = item.GetUserFilter().GetUserId()
		}
	}

	for _, m := range metrics {
		for _, required := range m.option.GetRequiredFilters() {
			if !seen[required] {
				return filters, invalidMetric("%s requires %s", m.id(), required)
			}
		}
	}

	return filters, nil
}

// metricRows is the report narrowed to the reader and every filter — and, when every asked metric is Ads expense, to the
// ADS kind, so its keys are the ads' own.
//
// ⚠ THE TWO DATES ARE LITERALS, NOT PARAMETERS, for the reason supplier's window gives
// (audits/services/supplier_service/performances/AnalyticGroupSearch.md, finding 2): a prepared statement may be planned
// once for any window. Safe: both are formatted here from a parsed time — only digits and dashes reach SQL.
func metricRows(db *gorm.DB, reader metricReader, filters metricFilters, adsOnly bool) *gorm.DB {
	query := db.
		Table("expense_metric_daily_reports AS r").
		Where(fmt.Sprintf("r.day BETWEEN DATE '%s' AND DATE '%s'",
			filters.start.Format(dateLayout), filters.end.Format(dateLayout)))

	if !reader.all {
		query = query.Where("r.team_id = ?", reader.teamID)
	}

	if adsOnly {
		query = query.Where("r.kind = ?", int32(expensev1.ExpenseKind_EXPENSE_KIND_ADS))
	}

	if filters.sellerID != 0 {
		query = query.Where("r.seller_id = ?", filters.sellerID)
	}

	if filters.shopID != 0 {
		query = query.Where("r.shop_id = ?", filters.shopID)
	}

	if filters.userID != 0 {
		query = query.Where("r.user_id = ?", filters.userID)
	}

	return query
}

// allAds reports whether every asked metric is Ads expense — then only ADS rows are read.
func allAds(metrics []expenseMetric) bool {
	for _, m := range metrics {
		if !m.adsOnly {
			return false
		}
	}

	return true
}

// metricKey is what a row of the table IS — the SQL a report row rolls up into.
type metricKey struct {
	sql   string
	isDay bool
}

// metricKeyOf reads a GroupType every asked metric supports. SUMMARY has no key. A week runs Monday to Sunday
// (a-week-is-monday-to-sunday-jakarta) — date_trunc('week') is ISO, Monday — and the days are already Jakarta days.
// Seller is a selling team's expenses, Warehouse a warehouse team's (the-warehouse-is-its-own-group).
func metricKeyOf(metrics []expenseMetric, group analytic_basev1.GroupType) (metricKey, error) {
	for _, m := range metrics {
		if !slices.Contains(m.option.GetSupportedGroupBy(), group) {
			return metricKey{}, invalidMetric("%s cannot be grouped by %s", m.id(), group)
		}
	}

	switch group {
	case analytic_basev1.GroupType_GROUP_TYPE_DAILY:
		return metricKey{sql: "r.day", isDay: true}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_WEEKLY:
		return metricKey{sql: "date_trunc('week', r.day)::date", isDay: true}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_MONTHLY:
		return metricKey{sql: "date_trunc('month', r.day)::date", isDay: true}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_YEARLY:
		return metricKey{sql: "date_trunc('year', r.day)::date", isDay: true}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_SHOP:
		return metricKey{sql: "r.shop_id"}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_TEAM:
		return metricKey{sql: "r.seller_id"}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE:
		return metricKey{sql: "r.warehouse_id"}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_USER:
		return metricKey{sql: "r.user_id"}, nil
	default:
		return metricKey{}, invalidMetric("%s has no key — a summary is read, never searched", group)
	}
}

// metricPeriodStart is the first day of the period `day` falls in — what a period's key must be.
func metricPeriodStart(group analytic_basev1.GroupType, day time.Time) time.Time {
	switch group {
	case analytic_basev1.GroupType_GROUP_TYPE_WEEKLY:
		back := (int(day.Weekday()) + 6) % 7 // Monday is 0 days back, Sunday 6

		return day.AddDate(0, 0, -back)
	case analytic_basev1.GroupType_GROUP_TYPE_MONTHLY:
		return time.Date(day.Year(), day.Month(), 1, 0, 0, 0, 0, time.UTC)
	case analytic_basev1.GroupType_GROUP_TYPE_YEARLY:
		return time.Date(day.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
	default:
		return day
	}
}

// metricSums is the five sums every grouped read selects: one per typed kind and their total. Ads expense's `amount`
// is the `ads` sum. Exact doubles, never rounded (the-backend-never-rounds-money).
const metricSums = "COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 1), 0)::float8 AS ads, " +
	"COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 2), 0)::float8 AS payroll, " +
	"COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 3), 0)::float8 AS operational, " +
	"COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 4), 0)::float8 AS other, " +
	"COALESCE(SUM(r.amount), 0)::float8 AS total"

// MetricSums is one key's figures as read.
type MetricSums struct {
	Ads         float64
	Payroll     float64
	Operational float64
	Other       float64
	Total       float64
}

func (s MetricSums) adsMessage() *expensev1.AdsExpenseMetric {
	return &expensev1.AdsExpenseMetric{Amount: s.Ads}
}

func (s MetricSums) expensesMessage() *expensev1.ExpensesMetric {
	return &expensev1.ExpensesMetric{
		Ads: s.Ads, Payroll: s.Payroll, Operational: s.Operational, Other: s.Other, Total: s.Total,
	}
}
