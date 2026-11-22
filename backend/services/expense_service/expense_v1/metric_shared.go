package expense_v1

import (
	"errors"
	"fmt"
	"slices"
	"strings"
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

// metricSums is the sums every grouped read selects (ExpensesMetric's fields, by their proto names): each typed kind's
// SPENDING (flow 0); THE MONTH TOTAL as Biaya's moves — spending − money in + capital out − capital in
// (the-expense-types-prototype-is-accepted, acceptance analytic/expense_metric.md givens 6–22); money in, capital out
// and capital in, positive; then ONE FIELD PER EXPENSE TYPE, its rows' net signed by the type's direction (signOf —
// money in minus), as Biaya's month card reads each type. Rows of type 0 (from before the types) are in their group and
// the total only. Ads expense's `amount` is the `ads` sum. Exact doubles, never rounded (the-backend-never-rounds-money);
// a minus is written `0 - sum`, so an empty or netted figure is +0, never −0.
var metricSums = buildMetricSums()

func buildMetricSums() string {
	parts := []string{
		"COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 1 AND r.flow = 0), 0)::float8 AS ads",
		"COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 2 AND r.flow = 0), 0)::float8 AS payroll",
		"COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 3 AND r.flow = 0), 0)::float8 AS operational",
		"COALESCE(SUM(r.amount) FILTER (WHERE r.kind = 4 AND r.flow = 0), 0)::float8 AS other",
		fmt.Sprintf("(COALESCE(SUM(r.amount) FILTER (WHERE r.flow IN (%d, %d)), 0) - "+
			"COALESCE(SUM(r.amount) FILTER (WHERE r.flow IN (%d, %d)), 0))::float8 AS total",
			flowSpending, flowCapitalOut, flowMoneyIn, flowCapitalIn),
		fmt.Sprintf("COALESCE(SUM(r.amount) FILTER (WHERE r.flow = %d), 0)::float8 AS money_in", flowMoneyIn),
		fmt.Sprintf("COALESCE(SUM(r.amount) FILTER (WHERE r.flow = %d), 0)::float8 AS capital_out", flowCapitalOut),
		fmt.Sprintf("COALESCE(SUM(r.amount) FILTER (WHERE r.flow = %d), 0)::float8 AS capital_in", flowCapitalIn),
	}

	for _, t := range expenseTypeList() {
		sum := fmt.Sprintf("COALESCE(SUM(r.amount) FILTER (WHERE r.type = %d), 0)", int32(t))
		if signOf(t) < 0 {
			sum = "0 - " + sum
		}

		parts = append(parts, fmt.Sprintf("(%s)::float8 AS %s", sum, typeField(t)))
	}

	return strings.Join(parts, ", ")
}

// metricGrouped is the report's figures per key — keySQL empty for the one headline row. Summed in TWO steps: first one
// SUM per key, kind, flow and type over the filtered report rows, then metricSums over those partial sums — equal to
// metricSums over the rows themselves (its every FILTER reads kind, flow and type alone), while its twenty-six FILTERed
// sums run over a few dozen partial rows per key instead of every report row. Root's year headline (~110 000 rows) read
// 45 ms with eight sums and 63–94 ms with the twenty-six on every row (TestPerf_ExpenseMetric, backlog #107).
func metricGrouped(rows *gorm.DB, keySQL string) *gorm.DB {
	const cols = "r.kind, r.flow, r.type"

	outer := rows.Session(&gorm.Session{NewDB: true})

	if keySQL == "" {
		partial := rows.
			Select(cols + ", SUM(r.amount) AS amount").
			Group(cols)

		return outer.
			Table("(?) AS r", partial).
			Select(metricSums)
	}

	partial := rows.
		Select(keySQL + " AS key, " + cols + ", SUM(r.amount) AS amount").
		Group(keySQL + ", " + cols)

	return outer.
		Table("(?) AS r", partial).
		Select("r.key AS key, " + metricSums).
		Group("r.key")
}

// expenseTypeList is every type of the fixed table (expense_types.go), in ExpenseType's order — the order of their
// fields in ExpensesMetric.
func expenseTypeList() []expensev1.ExpenseType {
	list := make([]expensev1.ExpenseType, 0, len(expenseTypes))
	for t := range expenseTypes {
		list = append(list, t)
	}

	slices.Sort(list)

	return list
}

// typeField is a type's field of ExpensesMetric — its enum name without the prefix, lower case: EXPENSE_TYPE_BANK_FEE is
// `bank_fee` (expense_analytic.proto, field 8 + the type's number). Also its column in metricSums and its sort name.
func typeField(t expensev1.ExpenseType) string {
	return strings.ToLower(strings.TrimPrefix(t.String(), "EXPENSE_TYPE_"))
}

// MetricSums is one key's figures as read — each a column of metricSums, by name.
type MetricSums struct {
	Ads         float64
	Payroll     float64
	Operational float64
	Other       float64
	Total       float64
	MoneyIn     float64
	CapitalOut  float64
	CapitalIn   float64

	// One per expense type, signed by its direction.
	AdsMarketplace            float64
	ContentEndorse            float64
	BasicSalary               float64
	Bonus                     float64
	Contributions             float64
	Electricity               float64
	Internet                  float64
	Kitchen                   float64
	Tools                     float64
	Equipment                 float64
	BankFee                   float64
	Discrepancy               float64
	OutsideDebtPaid           float64
	OutsideReceivableReceived float64
	Prive                     float64
	CapitalDeposit            float64
	OtherOut                  float64
	OtherIn                   float64
}

func (s MetricSums) adsMessage() *expensev1.AdsExpenseMetric {
	return &expensev1.AdsExpenseMetric{Amount: s.Ads}
}

func (s MetricSums) expensesMessage() *expensev1.ExpensesMetric {
	return &expensev1.ExpensesMetric{
		Ads: s.Ads, Payroll: s.Payroll, Operational: s.Operational, Other: s.Other, Total: s.Total,
		MoneyIn: s.MoneyIn, CapitalOut: s.CapitalOut, CapitalIn: s.CapitalIn,

		AdsMarketplace: s.AdsMarketplace, ContentEndorse: s.ContentEndorse,
		BasicSalary: s.BasicSalary, Bonus: s.Bonus, Contributions: s.Contributions,
		Electricity: s.Electricity, Internet: s.Internet, Kitchen: s.Kitchen, Tools: s.Tools, Equipment: s.Equipment,
		BankFee: s.BankFee, Discrepancy: s.Discrepancy,
		OutsideDebtPaid: s.OutsideDebtPaid, OutsideReceivableReceived: s.OutsideReceivableReceived, Prive: s.Prive,
		CapitalDeposit: s.CapitalDeposit, OtherOut: s.OtherOut, OtherIn: s.OtherIn,
	}
}
