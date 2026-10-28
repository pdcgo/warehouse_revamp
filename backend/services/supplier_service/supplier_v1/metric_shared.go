package supplier_v1

import (
	"errors"
	"fmt"
	"slices"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_metric"
)

// THE ONE METRIC this service serves, `metrics/suppliers` — read off SupplierMetric's own descriptor, so the id, the
// filters, the groups and the sortable fields are stated once, in the proto (docs/business/analytic/rpc_provide.md).
var (
	supplierMetricDesc   = (&supplierv1.SupplierMetric{}).ProtoReflect().Descriptor()
	supplierMetricOption = san_metric.OptionOf(supplierMetricDesc)
)

var (
	errUnknownMetric = connect.NewError(
		connect.CodeInvalidArgument,
		fmt.Errorf("this service serves only %q", supplierMetricOption.GetMetricId()),
	)
	errRangeBackwards = connect.NewError(
		connect.CodeInvalidArgument,
		errors.New("date_min must not be after date_max"),
	)
)

// metricScope is what a request's filters narrow the figures to. Every filter is the metric's own: the screen offers
// only those (the-fill-step-scopes-its-numbers-by-the-filters).
type metricScope struct {
	start, end    time.Time
	restockTeamID uint64 // TEAM — whose restocks; 0 = every team's
	supplierID    uint64 // SUPPLIER — one supplier; 0 = every supplier
}

// parseFilters reads a request's filters. Each case's field number IS its FilterType
// (a-filter-names-one-id-and-shares-its-types-number), so the type comes off the set case with no table. A filter the
// metric does not support, a repeated one, or a missing required one is InvalidArgument.
func parseFilters(items []*analytic_basev1.FilterItem) (metricScope, error) {
	var scope metricScope

	seen := map[analytic_basev1.FilterType]bool{}

	for _, item := range items {
		reflected := item.ProtoReflect()

		set := reflected.WhichOneof(reflected.Descriptor().Oneofs().ByName("f"))
		if set == nil {
			return scope, invalid("a filter item carries no filter")
		}

		kind := analytic_basev1.FilterType(set.Number())

		if !slices.Contains(supplierMetricOption.GetSupportedFilters(), kind) {
			return scope, invalid("%s does not support %s", supplierMetricOption.GetMetricId(), kind)
		}

		if seen[kind] {
			return scope, invalid("%s is sent twice", kind)
		}

		seen[kind] = true

		switch kind {
		case analytic_basev1.FilterType_FILTER_TYPE_DATE_RANGE:
			window := item.GetDateRangeFilter()

			start, err := parseDate(window.GetDateMin())
			if err != nil {
				return scope, err
			}

			end, err := parseDate(window.GetDateMax())
			if err != nil {
				return scope, err
			}

			if start.After(end) {
				return scope, errRangeBackwards
			}

			scope.start, scope.end = start, end
		case analytic_basev1.FilterType_FILTER_TYPE_TEAM:
			scope.restockTeamID = item.GetTeamFilter().GetTeamId()
		case analytic_basev1.FilterType_FILTER_TYPE_SUPPLIER:
			scope.supplierID = item.GetSupplierFilter().GetSupplierId()
		}
	}

	for _, required := range supplierMetricOption.GetRequiredFilters() {
		if !seen[required] {
			return scope, invalid("%s requires %s", supplierMetricOption.GetMetricId(), required)
		}
	}

	return scope, nil
}

// rows is the report table narrowed by every filter — the window, the team and the supplier.
func (m metricScope) rows(db *gorm.DB) *gorm.DB {
	query := window(db, m.start, m.end, m.restockTeamID)

	if m.supplierID != 0 {
		query = query.Where("r.supplier_id = ?", m.supplierID)
	}

	return query
}

// metricGroup is what a row of the table IS — the SQL a report row rolls up into.
type metricGroup struct {
	key   string // the row's key over the report alias `r`
	isDay bool   // keyed by a period's first day, not by an id
}

// groupOf reads a GroupType the metric supports. SUMMARY has no key — it is the whole scope — and is answered apart.
func groupOf(group analytic_basev1.GroupType) (metricGroup, error) {
	if !slices.Contains(supplierMetricOption.GetSupportedGroupBy(), group) {
		return metricGroup{}, invalid("%s cannot be grouped by %s", supplierMetricOption.GetMetricId(), group)
	}

	// A week runs Monday to Sunday (a-week-is-monday-to-sunday-jakarta) — Postgres' date_trunc('week') is ISO, Monday.
	// The days are already Jakarta days (each-figure-is-read-at-the-accept), so no zone is applied here.
	switch group {
	case analytic_basev1.GroupType_GROUP_TYPE_DAILY:
		return metricGroup{key: "r.day", isDay: true}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_WEEKLY:
		return metricGroup{key: "date_trunc('week', r.day)::date", isDay: true}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_MONTHLY:
		return metricGroup{key: "date_trunc('month', r.day)::date", isDay: true}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_YEARLY:
		return metricGroup{key: "date_trunc('year', r.day)::date", isDay: true}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_SUPPLIER:
		return metricGroup{key: "r.supplier_id"}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_PRODUCT:
		return metricGroup{key: "r.product_id"}, nil
	default:
		return metricGroup{}, invalid("%s has no key — a summary is read, never searched", group)
	}
}

// bucketStart is the first day of the period `day` falls in — what a period's key must be.
func bucketStart(group analytic_basev1.GroupType, day time.Time) time.Time {
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

// sortOrder is a search's ORDER BY over the grouped rows `g` (key, the six sums, units). The field is found by its
// PROTO name and must carry can_sort (a-sort-field-is-its-proto-name); the key, DESC, breaks every tie
// (the-key-breaks-every-tie); an unspecified direction is DESC.
//
// A field with rank_min_sample ranks only the rows with at least that many units; the rest follow, in key order
// (a-rate-ranks-only-above-its-minimum-sample) — the minimum read off the proto, never a constant of its own.
func sortOrder(sort *analytic_basev1.MetricSort) (string, error) {
	if sort.GetMetricId() != supplierMetricOption.GetMetricId() {
		return "", errUnknownMetric
	}

	field, option, err := san_metric.SortField(supplierMetricDesc, sort.GetField())
	if err != nil {
		return "", connect.NewError(connect.CodeInvalidArgument, err)
	}

	direction := "DESC"
	if sort.GetSortType() == analytic_basev1.SortType_SORT_TYPE_ASC {
		direction = "ASC"
	}

	value := sortValue(field)

	if minimum := option.GetRankMinSample(); minimum > 0 {
		return fmt.Sprintf(
			"(g.units >= %[1]d) DESC, CASE WHEN g.units >= %[1]d THEN %[2]s END %[3]s NULLS LAST, g.key DESC",
			minimum, value, direction,
		), nil
	}

	return fmt.Sprintf("%s %s, g.key DESC", value, direction), nil
}

// sortValue is a sortable field as SQL over the grouped rows. The six figures are their own columns; the broken rate
// is computed from the same sums the row carries. A grouped row always received something (a report row is written
// only when a line counted units), so the divisor is never 0 — NULLIF keeps that a property of the query.
func sortValue(field protoreflect.FieldDescriptor) string {
	if field.Name() == "broken_rate" {
		return "g.shipping_broken_count::numeric / NULLIF(g.units, 0)"
	}

	return "g." + string(field.Name())
}

func invalid(format string, args ...any) error {
	return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf(format, args...))
}
