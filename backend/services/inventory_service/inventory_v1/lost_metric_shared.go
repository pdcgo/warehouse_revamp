package inventory_v1

import (
	"errors"
	"fmt"
	"slices"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1/inventoryv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_metric"
)

// LOST STOCK — `metrics/inventory/lost` (docs/business/analytic/rpc_provide_decision.md —
// inventory-lost-counts-the-warehouses-custody-losses, inventory-lost-is-gross,
// inventory-lost-groups-and-sits-under-inventory, a-warehouse-sees-its-lost-amount), read from
// `inventory_lost_daily_reports`, which inventory_mutations.foldLost writes in the loss's own transaction.

// lostDateLayout is a Jakarta day as the analytic contract writes it (a-day-is-a-jakarta-date-string).
const lostDateLayout = "2006-01-02"

var _ inventoryv1connect.InventoryAnalyticServiceHandler = (*Service)(nil)

// lostMetricOption is the one metric this service serves, read off its message so the id is stated once, in the proto.
var lostMetricOption = san_metric.OptionOf((&inventoryv1.InventoryLostMetric{}).ProtoReflect().Descriptor())

// lostColumn is a sortable field's report column — the field's own name.
var lostColumn = map[string]string{"lost_count": "lost_count", "lost_amount": "lost_amount"}

var errLostRangeBackwards = errors.New("date_min must not be after date_max")

func invalidLost(format string, args ...any) error {
	return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf(format, args...))
}

// checkLostMetric refuses any metric id but Lost stock's.
func checkLostMetric(metricID string) error {
	if metricID != lostMetricOption.GetMetricId() {
		return invalidLost("this service does not serve %q", metricID)
	}

	return nil
}

// lostReader is WHO reads (a-warehouse-sees-its-lost-amount): the warehouse that held the stock and the seller that
// owns it — one condition, `warehouse_id = T OR team_id = T`, so the service never needs the team's type; both read
// both fields. The root team reads every team's, as it does the order metrics. Any other team matches no row.
type lostReader struct {
	all    bool
	teamID uint64
}

func lostReaderOf(teamID uint64) lostReader {
	return lostReader{all: teamID == san_auth.RootTeamID, teamID: teamID}
}

// lostFilters is what the filters narrow the figures to — each a dimension, never the scope.
type lostFilters struct {
	start, end  time.Time
	teamID      uint64 // TEAM — the seller owning the stock
	warehouseID uint64
	productID   uint64
	supplierID  uint64
}

// parseLostFilters reads a request's filters. Each case's field number IS its FilterType
// (a-filter-names-one-id-and-shares-its-types-number). One the metric does not support (a shop — lost stock has none),
// a repeated one, or a missing date range is InvalidArgument.
func parseLostFilters(items []*analytic_basev1.FilterItem) (lostFilters, error) {
	var filters lostFilters

	seen := map[analytic_basev1.FilterType]bool{}

	for _, item := range items {
		reflected := item.ProtoReflect()

		set := reflected.WhichOneof(reflected.Descriptor().Oneofs().ByName("f"))
		if set == nil {
			return filters, invalidLost("a filter item carries no filter")
		}

		kind := analytic_basev1.FilterType(set.Number())

		if !slices.Contains(lostMetricOption.GetSupportedFilters(), kind) {
			return filters, invalidLost("%s does not support %s", lostMetricOption.GetMetricId(), kind)
		}

		if seen[kind] {
			return filters, invalidLost("%s is sent twice", kind)
		}

		seen[kind] = true

		switch kind {
		case analytic_basev1.FilterType_FILTER_TYPE_DATE_RANGE:
			window := item.GetDateRangeFilter()

			start, err := time.Parse(lostDateLayout, window.GetDateMin())
			if err != nil {
				return filters, invalidLost("date_min is not a day: %q", window.GetDateMin())
			}

			end, err := time.Parse(lostDateLayout, window.GetDateMax())
			if err != nil {
				return filters, invalidLost("date_max is not a day: %q", window.GetDateMax())
			}

			if start.After(end) {
				return filters, connect.NewError(connect.CodeInvalidArgument, errLostRangeBackwards)
			}

			// A YEAR AT MOST, both days counted (a-metric-reads-at-most-a-year).
			err = san_metric.CheckRange(start, end)
			if err != nil {
				return filters, connect.NewError(connect.CodeInvalidArgument, err)
			}

			filters.start, filters.end = start, end
		case analytic_basev1.FilterType_FILTER_TYPE_TEAM:
			filters.teamID = item.GetTeamFilter().GetTeamId()
		case analytic_basev1.FilterType_FILTER_TYPE_WAREHOUSE:
			filters.warehouseID = item.GetWarehouseFilter().GetWarehouseId()
		case analytic_basev1.FilterType_FILTER_TYPE_PRODUCT:
			filters.productID = item.GetProductFilter().GetProductId()
		case analytic_basev1.FilterType_FILTER_TYPE_SUPPLIER:
			filters.supplierID = item.GetSupplierFilter().GetSupplierId()
		}
	}

	for _, required := range lostMetricOption.GetRequiredFilters() {
		if !seen[required] {
			return filters, invalidLost("%s requires %s", lostMetricOption.GetMetricId(), required)
		}
	}

	return filters, nil
}

// lostRows is the report narrowed to the reader and every filter.
//
// ⚠ THE TWO DATES ARE LITERALS, NOT PARAMETERS, for the reason supplier's window gives
// (audits/services/supplier_service/performances/AnalyticGroupSearch.md, finding 2): a prepared statement may be planned
// once for any window. Safe: both are formatted here from a parsed time — only digits and dashes reach SQL.
func lostRows(db *gorm.DB, reader lostReader, filters lostFilters) *gorm.DB {
	query := db.
		Table("inventory_lost_daily_reports AS r").
		Where(fmt.Sprintf("r.day BETWEEN DATE '%s' AND DATE '%s'",
			filters.start.Format(lostDateLayout), filters.end.Format(lostDateLayout)))

	if !reader.all {
		// The warehouse that held it, or the seller that owns it — a BitmapOr of the two (…, day) indexes.
		query = query.Where("(r.warehouse_id = ? OR r.team_id = ?)", reader.teamID, reader.teamID)
	}

	if filters.teamID != 0 {
		query = query.Where("r.team_id = ?", filters.teamID)
	}

	if filters.warehouseID != 0 {
		query = query.Where("r.warehouse_id = ?", filters.warehouseID)
	}

	if filters.productID != 0 {
		query = query.Where("r.product_id = ?", filters.productID)
	}

	if filters.supplierID != 0 {
		query = query.Where("r.supplier_id = ?", filters.supplierID)
	}

	return query
}

// lostKey is what a row of the table IS — the SQL a report row rolls up into.
type lostKey struct {
	sql   string
	isDay bool
}

// lostKeyOf reads a GroupType the metric supports. SUMMARY has no key. A week runs Monday to Sunday
// (a-week-is-monday-to-sunday-jakarta) — date_trunc('week') is ISO, Monday — and the days are already Jakarta days.
func lostKeyOf(group analytic_basev1.GroupType) (lostKey, error) {
	if !slices.Contains(lostMetricOption.GetSupportedGroupBy(), group) {
		return lostKey{}, invalidLost("%s cannot be grouped by %s", lostMetricOption.GetMetricId(), group)
	}

	switch group {
	case analytic_basev1.GroupType_GROUP_TYPE_DAILY:
		return lostKey{sql: "r.day", isDay: true}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_WEEKLY:
		return lostKey{sql: "date_trunc('week', r.day)::date", isDay: true}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_MONTHLY:
		return lostKey{sql: "date_trunc('month', r.day)::date", isDay: true}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_YEARLY:
		return lostKey{sql: "date_trunc('year', r.day)::date", isDay: true}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_PRODUCT:
		return lostKey{sql: "r.product_id"}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_SUPPLIER:
		return lostKey{sql: "r.supplier_id"}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_TEAM:
		return lostKey{sql: "r.team_id"}, nil
	case analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE:
		return lostKey{sql: "r.warehouse_id"}, nil
	default:
		return lostKey{}, invalidLost("%s has no key — a summary is read, never searched", group)
	}
}

// lostPeriodStart is the first day of the period `day` falls in — what a period's key must be.
func lostPeriodStart(group analytic_basev1.GroupType, day time.Time) time.Time {
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

// lostSums is the two sums every grouped read selects.
const lostSums = "COALESCE(SUM(r.lost_count), 0) AS lost_count, COALESCE(SUM(r.lost_amount), 0)::float8 AS lost_amount"

// LostSums is one key's figures as read.
type LostSums struct {
	LostCount  int64
	LostAmount float64
}

func (s LostSums) message() *inventoryv1.InventoryLostMetric {
	return &inventoryv1.InventoryLostMetric{LostCount: s.LostCount, LostAmount: s.LostAmount}
}

func lostDBError(err error) error {
	return connect.NewError(connect.CodeInternal, err)
}
