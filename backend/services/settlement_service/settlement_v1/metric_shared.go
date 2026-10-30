package settlement_v1

import (
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_metric"
)

// settlementMetric is one of the two settlement metrics (settlement-serves-its-headline-and-its-breakdown): its
// message and the option read off it — so the id, the filters, the groups and the sortable fields are stated once, in
// the proto.
type settlementMetric struct {
	desc   protoreflect.MessageDescriptor
	option *analytic_basev1.MetricOption
}

func newSettlementMetric(message proto.Message) *settlementMetric {
	desc := message.ProtoReflect().Descriptor()

	return &settlementMetric{desc: desc, option: san_metric.OptionOf(desc)}
}

var (
	// The headline: sales, received, withdrawn, gap, take rate, position to date.
	metricSettlement = newSettlementMetric(&settlementv1.SettlementMetric{})
	// The breakdown: the ten types that make up `received`.
	metricTypes = newSettlementMetric(&settlementv1.SettlementTypeMetric{})

	settlementMetrics = []*settlementMetric{metricSettlement, metricTypes}
)

func settlementMetricByID(metricID string) (*settlementMetric, error) {
	for _, metric := range settlementMetrics {
		if metric.option.GetMetricId() == metricID {
			return metric, nil
		}
	}

	return nil, invalidMetric("this service does not serve %q", metricID)
}

func invalidMetric(format string, args ...any) error {
	return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf(format, args...))
}

var (
	errMetricRangeBackwards = connect.NewError(connect.CodeInvalidArgument,
		errors.New("date_min must not be after date_max"))

	// one-settlement-metric-reads-both-tables: the shop table has no person and the person table no shop.
	errShopAndPerson = connect.NewError(connect.CodeInvalidArgument,
		errors.New("a shop and a person cannot be read together — no settlement report holds both"))
)

// ── the definition ───────────────────────────────────────────────────────────────────────────────

// measureSQL is THE DEFINITION of every served field, over one key's base sums `b` — the 13 type columns and the
// position at the key's end, in the log's sign (settlement-serves-its-headline-and-its-breakdown). The fill selects it
// to answer and the search orders by it to rank, so the order on screen and the numbers beside it are one computation.
//
// ⚠ `received` IS Σ SettlementTypeMetric's fields, read off its descriptor — so the breakdown explains the headline by
// construction, and a type added to the breakdown joins `received` with no second edit.
var measureSQL = buildMeasureSQL()

func buildMeasureSQL() map[string]string {
	types := fieldNames(metricTypes.desc)

	sales := "(-(b.initial_total + b.initial_total_cancel))"
	received := "(b." + strings.Join(types, " + b.") + ")"
	gap := "(" + sales + " - " + received + ")"

	out := map[string]string{
		"sales":    sales,
		"received": received,
		// A withdrawal is NEGATIVE in the log — money leaving the wallet — and served as what went out.
		"withdrawn": "(-b.withdrawal)",
		"gap":       gap,
		// From the key's own sums, never an average of rates. NULL — unset — with no sale to divide by.
		"take_rate":        "CASE WHEN " + sales + " > 0 THEN " + gap + "::float8 / " + sales + "::float8 END",
		"position_to_date": "(-b.close_balance)",
	}

	for _, column := range types {
		out[column] = "b." + column
	}

	return out
}

// fieldNames is a message's field names, in field order.
func fieldNames(desc protoreflect.MessageDescriptor) []string {
	fields := desc.Fields()
	names := make([]string, 0, fields.Len())

	for i := range fields.Len() {
		names = append(names, string(fields.Get(i).Name()))
	}

	return names
}

// measuresSelect renders every measure as its field's name: "(…) AS sales, …".
func measuresSelect() string {
	parts := make([]string, 0, len(measureSQL))

	for _, metric := range settlementMetrics {
		for _, name := range fieldNames(metric.desc) {
			parts = append(parts, measureSQL[name]+" AS "+name)
		}
	}

	return strings.Join(parts, ", ")
}

// init refuses a build in which a served field has no definition, or a by-type field names no report column — either
// would be silently zero on every screen.
func init() {
	for _, metric := range settlementMetrics {
		for _, name := range fieldNames(metric.desc) {
			if _, ok := measureSQL[name]; !ok {
				panic(fmt.Sprintf("settlement metrics: %s.%s has no definition in measureSQL", metric.desc.FullName(), name))
			}
		}
	}

	for _, name := range fieldNames(metricTypes.desc) {
		if _, ok := columnOfType(name); !ok {
			panic("settlement metrics: SettlementTypeMetric." + name + " names no report column")
		}
	}
}

// figureRow is one key's figures — every field of both metrics, by its proto name.
type figureRow struct {
	Key string

	Sales          int64
	Received       int64
	Withdrawn      int64
	Gap            int64
	TakeRate       *float64
	PositionToDate int64

	Fund                  int64
	ExternalAdsFee        int64
	AffiliateFee          int64
	MarketplaceAdjustment int64
	ShipmentAdjustment    int64
	LogisticReimbursement int64
	PlatformReimbursement int64
	MarketplaceProgram    int64
	Other                 int64
	SystemAdjustment      int64
}

func (f figureRow) settlement() *settlementv1.SettlementMetric {
	return &settlementv1.SettlementMetric{
		Sales:          f.Sales,
		Received:       f.Received,
		Withdrawn:      f.Withdrawn,
		Gap:            f.Gap,
		TakeRate:       f.TakeRate,
		PositionToDate: f.PositionToDate,
	}
}

func (f figureRow) types() *settlementv1.SettlementTypeMetric {
	return &settlementv1.SettlementTypeMetric{
		Fund:                  f.Fund,
		ExternalAdsFee:        f.ExternalAdsFee,
		AffiliateFee:          f.AffiliateFee,
		MarketplaceAdjustment: f.MarketplaceAdjustment,
		ShipmentAdjustment:    f.ShipmentAdjustment,
		LogisticReimbursement: f.LogisticReimbursement,
		PlatformReimbursement: f.PlatformReimbursement,
		MarketplaceProgram:    f.MarketplaceProgram,
		Other:                 f.Other,
		SystemAdjustment:      f.SystemAdjustment,
	}
}

// ── the request ──────────────────────────────────────────────────────────────────────────────────

// metricFilters is what a request's filters narrow the figures to. Every one is a dimension, never the scope.
type metricFilters struct {
	start, end time.Time
	teamID     uint64
	shopID     uint64
	userID     uint64
}

// parseMetricFilters reads a request's filters against every asked metric. Each case's field number IS its FilterType
// (a-filter-names-one-id-and-shares-its-types-number). A filter a metric does not support, a repeated one, or a missing
// required one is InvalidArgument.
func parseMetricFilters(items []*analytic_basev1.FilterItem, metrics []*settlementMetric) (metricFilters, error) {
	var filters metricFilters

	seen := map[analytic_basev1.FilterType]bool{}

	for _, item := range items {
		reflected := item.ProtoReflect()

		set := reflected.WhichOneof(reflected.Descriptor().Oneofs().ByName("f"))
		if set == nil {
			return filters, invalidMetric("a filter item carries no filter")
		}

		kind := analytic_basev1.FilterType(set.Number())

		for _, metric := range metrics {
			if !slices.Contains(metric.option.GetSupportedFilters(), kind) {
				return filters, invalidMetric("%s does not support %s", metric.option.GetMetricId(), kind)
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
				return filters, errMetricRangeBackwards
			}

			filters.start, filters.end = start, end
		case analytic_basev1.FilterType_FILTER_TYPE_TEAM:
			filters.teamID = item.GetTeamFilter().GetTeamId()
		case analytic_basev1.FilterType_FILTER_TYPE_SHOP:
			filters.shopID = item.GetShopFilter().GetShopId()
		case analytic_basev1.FilterType_FILTER_TYPE_USER:
			filters.userID = item.GetUserFilter().GetUserId()
		}
	}

	for _, metric := range metrics {
		for _, required := range metric.option.GetRequiredFilters() {
			if !seen[required] {
				return filters, invalidMetric("%s requires %s", metric.option.GetMetricId(), required)
			}
		}
	}

	return filters, nil
}

// checkGroup refuses a GroupType some asked metric does not list.
func checkGroup(group analytic_basev1.GroupType, metrics []*settlementMetric) error {
	for _, metric := range metrics {
		if !slices.Contains(metric.option.GetSupportedGroupBy(), group) {
			return invalidMetric("%s cannot be grouped by %s", metric.option.GetMetricId(), group)
		}
	}

	return nil
}

// tableOf picks the table a request reads (one-settlement-metric-reads-both-tables): the person table when it groups
// or filters by a person, the shop table otherwise — a team, a period and the headline agree on either, because every
// log row is folded into both. A shop and a person together is refused.
func tableOf(group analytic_basev1.GroupType, filters metricFilters) (reportGrain, error) {
	person := group == analytic_basev1.GroupType_GROUP_TYPE_USER || filters.userID != 0
	shop := group == analytic_basev1.GroupType_GROUP_TYPE_SHOP || filters.shopID != 0

	if person && shop {
		return reportGrain{}, errShopAndPerson
	}

	if person {
		return userDaily, nil
	}

	return shopDaily, nil
}

// scopeOf renders the WHERE every read of `r` runs under: the caller's team — none from the root team, the one scope
// from which crossing teams is authorised — and each filter. Every value is a parsed id, so it is written as a literal.
func scopeOf(teamID uint64, filters metricFilters) string {
	conditions := []string{"TRUE"}

	if teamID != san_auth.RootTeamID {
		conditions = append(conditions, "r.team_id = "+strconv.FormatUint(teamID, 10))
	}

	if filters.teamID != 0 {
		conditions = append(conditions, "r.team_id = "+strconv.FormatUint(filters.teamID, 10))
	}

	if filters.shopID != 0 {
		conditions = append(conditions, "r.shop_id = "+strconv.FormatUint(filters.shopID, 10))
	}

	if filters.userID != 0 {
		conditions = append(conditions, "r.user_id = "+strconv.FormatUint(filters.userID, 10))
	}

	return strings.Join(conditions, " AND ")
}

// idColumnOf is the report column an id group's rows are keyed by.
func idColumnOf(group analytic_basev1.GroupType) (string, bool) {
	switch group {
	case analytic_basev1.GroupType_GROUP_TYPE_TEAM:
		return "team_id", true
	case analytic_basev1.GroupType_GROUP_TYPE_SHOP:
		return "shop_id", true
	case analytic_basev1.GroupType_GROUP_TYPE_USER:
		return "user_id", true
	default:
		return "", false
	}
}

func isTimeGroup(group analytic_basev1.GroupType) bool {
	switch group {
	case analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		analytic_basev1.GroupType_GROUP_TYPE_WEEKLY,
		analytic_basev1.GroupType_GROUP_TYPE_MONTHLY,
		analytic_basev1.GroupType_GROUP_TYPE_YEARLY:
		return true
	default:
		return false
	}
}

// ── periods ──────────────────────────────────────────────────────────────────────────────────────

// periodStart is the first day of the period `day` falls in — what a period's key must be. A week runs Monday to
// Sunday (a-week-is-monday-to-sunday-jakarta); the report's days are already Jakarta days.
func periodStart(group analytic_basev1.GroupType, day time.Time) time.Time {
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

// periodEnd is the last day of the period that starts on `start`.
func periodEnd(group analytic_basev1.GroupType, start time.Time) time.Time {
	switch group {
	case analytic_basev1.GroupType_GROUP_TYPE_WEEKLY:
		return start.AddDate(0, 0, 6)
	case analytic_basev1.GroupType_GROUP_TYPE_MONTHLY:
		return start.AddDate(0, 1, -1)
	case analytic_basev1.GroupType_GROUP_TYPE_YEARLY:
		return start.AddDate(1, 0, -1)
	default:
		return start
	}
}

// bucket is one period as a row: `at` is its key, its first day, and from/to are the period clipped to the window —
// what its movement is summed over, and the day its position is read at.
type bucket struct {
	at, from, to time.Time
}

// bucketOf clips the period starting on `at` to the window. False when the two do not meet: the period is outside
// what the filters ask, and its figures are zero.
func bucketOf(group analytic_basev1.GroupType, at time.Time, filters metricFilters) (bucket, bool) {
	from, to := at, periodEnd(group, at)

	if from.Before(filters.start) {
		from = filters.start
	}

	if to.After(filters.end) {
		to = filters.end
	}

	return bucket{at: at, from: from, to: to}, !from.After(to)
}

// searchSpan caps how many periods a time-group SEARCH ranks — every one of them is a position read. The fill needs no
// cap: it is asked a page.
var searchSpan = map[analytic_basev1.GroupType]int{
	analytic_basev1.GroupType_GROUP_TYPE_DAILY:   366,
	analytic_basev1.GroupType_GROUP_TYPE_WEEKLY:  260,
	analytic_basev1.GroupType_GROUP_TYPE_MONTHLY: 60,
	analytic_basev1.GroupType_GROUP_TYPE_YEARLY:  20,
}

// windowBuckets is every period the window touches, oldest first — a quiet one included, since it still has a
// position.
func windowBuckets(group analytic_basev1.GroupType, filters metricFilters) ([]bucket, error) {
	out := []bucket{}

	for at := periodStart(group, filters.start); !at.After(filters.end); at = periodEnd(group, at).AddDate(0, 0, 1) {
		if len(out) == searchSpan[group] {
			return nil, invalidMetric("the window holds more than %d periods of %s — narrow it or rank a coarser group",
				searchSpan[group], group)
		}

		b, _ := bucketOf(group, at, filters)
		out = append(out, b)
	}

	return out, nil
}

// ── the SQL ──────────────────────────────────────────────────────────────────────────────────────

// sqlDay is a day as a SQL literal. Safe: formatted from a parsed time, so only digits and dashes reach SQL — and a
// literal, not a parameter, so a prepared statement is never planned once for any window (the reason supplier's window
// gives: audits/services/supplier_service/performances/AnalyticGroupSearch.md, finding 2).
func sqlDay(day time.Time) string {
	return "DATE '" + day.Format(dateLayout) + "'"
}

// sqlDays renders days as a date[] literal.
func sqlDays(days []time.Time) string {
	parts := make([]string, 0, len(days))
	for _, day := range days {
		parts = append(parts, day.Format(dateLayout))
	}

	return "CAST('{" + strings.Join(parts, ",") + "}' AS date[])"
}

// idBase is one row per id with a position at or before the window's end — keyed `k`, the id — carrying the window's
// movement and that position:
//
//   - a key exists once it holds ANY row up to the window's end, so a key quiet in the window still carries its
//     position in;
//   - the position is Σ over the key's positions (a shop × team, or a person × team) of each one's latest close;
//   - a row with no id recorded is left out: the contract cannot send 0 back as a key (IDList's ids are > 0).
//
// `ids` narrows it to the asked keys; nil reads every key.
func idBase(grain reportGrain, column, scope string, filters metricFilters, ids []uint64) string {
	narrow := ""

	if ids != nil {
		parts := make([]string, 0, len(ids))
		for _, id := range ids {
			parts = append(parts, strconv.FormatUint(id, 10))
		}

		narrow = " AND r." + column + " IN (" + strings.Join(parts, ", ") + ")"
	}

	return fmt.Sprintf(`
WITH scoped AS (
    SELECT r.*, r.%[2]s AS gid
    FROM %[1]s r
    WHERE %[3]s AND r.%[2]s <> 0 AND r.day <= %[4]s%[5]s
),
latest AS (
    SELECT p.gid, SUM(p.close_balance) AS close_balance
    FROM (
        SELECT DISTINCT ON (%[6]s) gid, close_balance
        FROM scoped
        ORDER BY %[6]s, day DESC
    ) p
    GROUP BY p.gid
),
moves AS (
    SELECT gid, %[7]s
    FROM scoped
    WHERE day >= %[8]s
    GROUP BY gid
),
base AS (
    SELECT l.gid AS k, %[9]s, l.close_balance
    FROM latest l
    LEFT JOIN moves m ON m.gid = l.gid
),
measured AS (
    SELECT CAST(b.k AS text) AS key, b.k, %[10]s
    FROM base b
)`,
		grain.table, column, scope, sqlDay(filters.end), narrow, columnsOf("", grain.position),
		movementSums(""), sqlDay(filters.start), movementsFrom("m"), measuresSelect())
}

// timeBase is one row per bucket — keyed `k`, its first day — carrying the movement over the clipped bucket and the
// position at its last day: Σ over every position of its latest close at or before that day. A bucket with no row is
// still a row, its position carried from the last one before it.
func timeBase(grain reportGrain, scope string, buckets []bucket) string {
	ats := make([]time.Time, 0, len(buckets))
	froms := make([]time.Time, 0, len(buckets))
	tos := make([]time.Time, 0, len(buckets))

	for _, b := range buckets {
		ats = append(ats, b.at)
		froms = append(froms, b.from)
		tos = append(tos, b.to)
	}

	return fmt.Sprintf(`
WITH buckets AS (
    SELECT * FROM unnest(%[4]s, %[5]s, %[6]s) AS t(at, bucket_from, bucket_to)
),
base AS (
    SELECT t.at AS k, %[7]s, COALESCE(c.close_balance, 0) AS close_balance
    FROM buckets t
    LEFT JOIN LATERAL (
        SELECT %[8]s
        FROM %[1]s r
        WHERE %[2]s AND r.day BETWEEN t.bucket_from AND t.bucket_to
    ) m ON TRUE
    LEFT JOIN LATERAL (
        SELECT SUM(x.close_balance) AS close_balance
        FROM (
            SELECT DISTINCT ON (%[3]s) r.close_balance
            FROM %[1]s r
            WHERE %[2]s AND r.day <= t.bucket_to
            ORDER BY %[3]s, r.day DESC
        ) x
    ) c ON TRUE
),
measured AS (
    SELECT to_char(b.k, 'YYYY-MM-DD') AS key, b.k, %[9]s
    FROM base b
)`,
		grain.table, scope, columnsOf("r", grain.position), sqlDays(ats), sqlDays(froms), sqlDays(tos),
		movementsFrom("m"), movementSums("r"), measuresSelect())
}

// figureColumns is the final SELECT's list — the key and every field, by name.
func figureColumns() string {
	columns := []string{"key"}

	for _, metric := range settlementMetrics {
		columns = append(columns, fieldNames(metric.desc)...)
	}

	return strings.Join(columns, ", ")
}
