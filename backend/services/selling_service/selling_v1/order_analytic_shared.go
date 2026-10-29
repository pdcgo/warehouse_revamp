package selling_v1

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_metric"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// metricDateLayout is a Jakarta day as the analytic contract writes it (a-day-is-a-jakarta-date-string).
const metricDateLayout = "2006-01-02"

// orderMetric is one of the five order metrics: its row in the report, its message and the option read off it — so the
// id, the filters, the groups and the sortable fields are stated once, in the proto.
type orderMetric struct {
	// The report's `metric` value.
	report string
	// The MetricData oneof's prefix — `<prefix>_by_id`, `_by_day`, `_summary`.
	oneof string
	// The message itself — what a key's figures are built from.
	prototype proto.Message
	desc      protoreflect.MessageDescriptor
	option    *analytic_basev1.MetricOption
}

// The three numbers every order metric carries, by FIELD NUMBER — the same on all five messages, so a field is mapped
// to its report column without a table per metric.
const (
	fieldCount   = 1 // *_count            → order_count
	fieldTotal   = 2 // *_total            → total      (money)
	fieldMpTotal = 3 // *_mp_total, mp_total → mp_total (money)
)

var reportColumn = map[protoreflect.FieldNumber]string{
	fieldCount:   "order_count",
	fieldTotal:   "total",
	fieldMpTotal: "mp_total",
}

func newOrderMetric(report, oneof string, message proto.Message) *orderMetric {
	desc := message.ProtoReflect().Descriptor()

	return &orderMetric{report: report, oneof: oneof, prototype: message, desc: desc, option: san_metric.OptionOf(desc)}
}

// orderMetrics is the five, in the doc's order.
var orderMetrics = []*orderMetric{
	newOrderMetric(reportCreated, "created", &sellingv1.OrderCreatedMetric{}),
	newOrderMetric(reportCancelled, "cancel", &sellingv1.OrderCancelMetric{}),
	newOrderMetric(reportReturnCreated, "return_created", &sellingv1.OrderReturnCreatedMetric{}),
	newOrderMetric(reportReturnArrived, "return_arrived", &sellingv1.OrderReturnArrivedMetric{}),
	newOrderMetric(reportLostCreated, "lost_created", &sellingv1.OrderLostCreatedMetric{}),
}

func orderMetricByID(metricID string) (*orderMetric, error) {
	for _, metric := range orderMetrics {
		if metric.option.GetMetricId() == metricID {
			return metric, nil
		}
	}

	return nil, invalidMetric("this service does not serve %q", metricID)
}

var errMetricRangeBackwards = errors.New("date_min must not be after date_max")

func invalidMetric(format string, args ...any) error {
	return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf(format, args...))
}

// metricReader is WHO is reading, from the request's scope (a-warehouse-reads-the-orders-it-ships): the root team every
// order, a warehouse the orders it ships, anyone else the orders it sold. `money` is false for a warehouse
// (a-warehouse-sees-no-seller-money).
type metricReader struct {
	all         bool
	sellerID    uint64
	warehouseID uint64
	money       bool
}

// readerOf decides the reader from the scope's TEAM TYPE — the service decides, never the screen.
func (a *Analytic) readerOf(ctx context.Context, teamID uint64) (metricReader, error) {
	if readsEveryTeam(teamID) {
		return metricReader{all: true, money: true}, nil
	}

	warehouse, err := a.teams.IsWarehouse(ctx, teamID)
	if err != nil {
		return metricReader{}, connect.NewError(connect.CodeUnavailable, fmt.Errorf("the team's type: %w", err))
	}

	if warehouse {
		return metricReader{warehouseID: teamID}, nil
	}

	return metricReader{sellerID: teamID, money: true}, nil
}

// metricFilters is what a request's filters narrow the figures to. Every one is a dimension, never the scope.
type metricFilters struct {
	start, end  time.Time
	teamID      uint64 // TEAM — the seller
	shopID      uint64
	warehouseID uint64
	userID      uint64 // USER — the creator
}

// parseMetricFilters reads a request's filters against every asked metric. Each case's field number IS its FilterType
// (a-filter-names-one-id-and-shares-its-types-number). A filter a metric does not support, a repeated one, or a missing
// required one is InvalidArgument.
func parseMetricFilters(items []*analytic_basev1.FilterItem, metrics []*orderMetric) (metricFilters, error) {
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

			start, err := time.Parse(metricDateLayout, window.GetDateMin())
			if err != nil {
				return filters, invalidMetric("date_min is not a day: %q", window.GetDateMin())
			}

			end, err := time.Parse(metricDateLayout, window.GetDateMax())
			if err != nil {
				return filters, invalidMetric("date_max is not a day: %q", window.GetDateMax())
			}

			if start.After(end) {
				return filters, connect.NewError(connect.CodeInvalidArgument, errMetricRangeBackwards)
			}

			filters.start, filters.end = start, end
		case analytic_basev1.FilterType_FILTER_TYPE_TEAM:
			filters.teamID = item.GetTeamFilter().GetTeamId()
		case analytic_basev1.FilterType_FILTER_TYPE_SHOP:
			filters.shopID = item.GetShopFilter().GetShopId()
		case analytic_basev1.FilterType_FILTER_TYPE_WAREHOUSE:
			filters.warehouseID = item.GetWarehouseFilter().GetWarehouseId()
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

// reportRows is the report narrowed to the reader's scope, the asked metrics and every filter.
//
// ⚠ THE TWO DATES ARE LITERALS, NOT PARAMETERS, for the reason supplier's window gives
// (audits/services/supplier_service/performances/AnalyticGroupSearch.md, finding 2): a prepared statement may be
// planned once for any window. Safe: both are formatted here from a parsed time, so only digits and dashes reach SQL.
func reportRows(db *gorm.DB, reader metricReader, filters metricFilters, metrics []*orderMetric) *gorm.DB {
	reports := make([]string, 0, len(metrics))
	for _, metric := range metrics {
		reports = append(reports, metric.report)
	}

	query := db.
		Table("order_daily_reports AS r").
		Where(fmt.Sprintf("r.day BETWEEN DATE '%s' AND DATE '%s'",
			filters.start.Format(metricDateLayout), filters.end.Format(metricDateLayout))).
		Where("r.metric IN ?", reports)

	switch {
	case reader.all:
	case reader.warehouseID != 0:
		query = query.Where("r.warehouse_id = ?", reader.warehouseID)
	default:
		query = query.Where("r.team_id = ?", reader.sellerID)
	}

	if filters.teamID != 0 {
		query = query.Where("r.team_id = ?", filters.teamID)
	}

	if filters.shopID != 0 {
		query = query.Where("r.shop_id = ?", filters.shopID)
	}

	if filters.warehouseID != 0 {
		query = query.Where("r.warehouse_id = ?", filters.warehouseID)
	}

	if filters.userID != 0 {
		query = query.Where("r.user_id = ?", filters.userID)
	}

	return query
}

// metricKey is what a row of the table IS — the SQL a report row rolls up into.
type metricKey struct {
	sql   string
	isDay bool
}

// keyOf reads a GroupType every asked metric supports. SUMMARY has no key — it is the whole scope — and is answered
// apart. A week runs Monday to Sunday (a-week-is-monday-to-sunday-jakarta) — date_trunc('week') is ISO, Monday — and
// the days are already Jakarta days, so no zone is applied here.
func keyOf(group analytic_basev1.GroupType, metrics []*orderMetric) (metricKey, error) {
	for _, metric := range metrics {
		if !slices.Contains(metric.option.GetSupportedGroupBy(), group) {
			return metricKey{}, invalidMetric("%s cannot be grouped by %s", metric.option.GetMetricId(), group)
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
	case analytic_basev1.GroupType_GROUP_TYPE_TEAM:
		return metricKey{sql: "r.team_id"}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_SHOP:
		return metricKey{sql: "r.shop_id"}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE:
		return metricKey{sql: "r.warehouse_id"}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_USER:
		return metricKey{sql: "r.user_id"}, nil
	default:
		return metricKey{}, invalidMetric("%s has no key — a summary is read, never searched", group)
	}
}

// periodStart is the first day of the period `day` falls in — what a period's key must be.
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

// reportSums is the three sums every grouped read selects.
const reportSums = "COALESCE(SUM(r.order_count), 0) AS order_count, COALESCE(SUM(r.total), 0) AS total, " +
	"COALESCE(SUM(r.mp_total), 0) AS mp_total"

// isMoney is whether a field is one a warehouse never sees.
func isMoney(field protoreflect.FieldDescriptor) bool {
	return field.Number() == fieldTotal || field.Number() == fieldMpTotal
}

// metricMessage is one key's figures as `metric`'s own message. A warehouse's money fields stay UNSET, never 0
// (a-warehouse-sees-no-seller-money) — that is what the `optional` is for.
func metricMessage(metric *orderMetric, sums selling_service_models.OrderMetricColumns, money bool) protoreflect.Message {
	msg := metric.prototype.ProtoReflect().New()
	fields := metric.desc.Fields()

	msg.Set(fields.ByNumber(fieldCount), protoreflect.ValueOfInt64(sums.OrderCount))

	if money {
		msg.Set(fields.ByNumber(fieldTotal), protoreflect.ValueOfFloat64(sums.Total))
		msg.Set(fields.ByNumber(fieldMpTotal), protoreflect.ValueOfInt64(sums.MpTotal))
	}

	return msg
}
