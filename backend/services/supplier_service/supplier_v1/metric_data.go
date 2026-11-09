package supplier_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// MetricData FILLS the keys a search returned with `metrics/suppliers` — or, grouped by SUMMARY with no keys, reads the
// headline: the same figures over the whole scope (the-headline-is-the-metric-grouped-by-summary).
//
//   - The filters scope the numbers, never the keys (the-fill-step-scopes-its-numbers-by-the-filters): every asked key
//     comes back, one with nothing in the scope all zero — never missing (the-rows-are-the-keys-step-one-sends).
//   - A period's key is its first day — the Monday of a week, the 1st of a month, 1 January.
//   - One answer per asked metric (one-call-answers-every-asked-metric); this service has one.
//
// TWO statements — the restock table's and Penjualan's, each grouped the same way, summed per key here (window()).
func (s *Service) MetricData(
	ctx context.Context,
	req *connect.Request[supplierv1.MetricDataRequest],
) (*connect.Response[supplierv1.MetricDataResponse], error) {
	msg := req.Msg

	for _, id := range msg.GetMetricIds() {
		if id != supplierMetricOption.GetMetricId() {
			return nil, errUnknownMetric
		}
	}

	scope, err := parseFilters(msg.GetFilters())
	if err != nil {
		return nil, err
	}

	data, err := s.supplierMetricData(ctx, scope, msg.GetGroupBy(), msg.GetKeys())
	if err != nil {
		return nil, err
	}

	datas := make([]*supplierv1.MetricData, 0, len(msg.GetMetricIds()))
	for range msg.GetMetricIds() {
		datas = append(datas, data)
	}

	asOf, err := s.asOf(ctx)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&supplierv1.MetricDataResponse{MetricDatas: datas, AsOfUnix: asOf}), nil
}

// asOf is when this service last folded an event — the newest claim in `supplier_event_logs` or the newest order the
// sales fold touched (`supplier_sale_orders`), unix seconds; 0 before the first (a-money-metric-says-as-of-when). One
// time for the service: its one metric is read from both folds.
func (s *Service) asOf(ctx context.Context) (int64, error) {
	var unix int64

	err := s.db.WithContext(ctx).
		Raw(`SELECT COALESCE(EXTRACT(EPOCH FROM GREATEST(
    (SELECT MAX(created_at) FROM supplier_event_logs),
    (SELECT MAX(updated_at) FROM supplier_sale_orders)
))::bigint, 0)`).
		Scan(&unix).
		Error
	if err != nil {
		return 0, internal(err)
	}

	return unix, nil
}

func (s *Service) supplierMetricData(
	ctx context.Context,
	scope metricScope,
	groupBy analytic_basev1.GroupType,
	keys *analytic_basev1.MetricKeys,
) (*supplierv1.MetricData, error) {
	db := s.db.WithContext(ctx)

	if groupBy == analytic_basev1.GroupType_GROUP_TYPE_SUMMARY {
		if keys.GetK() != nil {
			return nil, invalid("a summary takes no keys")
		}

		var total, sales supplier_service_models.SupplierFigureSums

		err := scope.rows(db).Select(figureSums("r")).Scan(&total).Error
		if err != nil {
			return nil, internal(err)
		}

		err = scope.salesRows(db).Select(salesSums("r")).Scan(&sales).Error
		if err != nil {
			return nil, internal(err)
		}

		return &supplierv1.MetricData{M: &supplierv1.MetricData_SupplierSummary{
			SupplierSummary: metricToProto(withSales(total, sales)),
		}}, nil
	}

	group, err := groupOf(groupBy)
	if err != nil {
		return nil, err
	}

	if group.isDay {
		return s.metricDataByDay(ctx, scope, groupBy, group, keys)
	}

	ids := keys.GetIds().GetIds()
	if keys.GetIds() == nil {
		return nil, invalid("%s is keyed by ids", groupBy)
	}

	items := make(map[uint64]*supplierv1.SupplierMetric, len(ids))
	for _, id := range ids {
		items[id] = metricToProto(supplier_service_models.SupplierFigureSums{})
	}

	if len(ids) > 0 {
		type row struct {
			Key uint64
			supplier_service_models.SupplierFigureSums
		}

		sums := map[uint64]supplier_service_models.SupplierFigureSums{}

		for _, read := range []struct {
			from *gorm.DB
			sums string
		}{
			{scope.rows(db), figureSums("r")},
			{scope.salesRows(db), salesSums("r")},
		} {
			var rows []row

			err = read.from.
				Where(group.key+" IN ?", ids).
				Select(group.key + " AS key, " + read.sums).
				Group(group.key).
				Scan(&rows).
				Error
			if err != nil {
				return nil, internal(err)
			}

			for _, r := range rows {
				sums[r.Key] = withSales(addRestock(sums[r.Key], r.SupplierFigureSums), r.SupplierFigureSums)
			}
		}

		for key, sum := range sums {
			items[key] = metricToProto(sum)
		}
	}

	return &supplierv1.MetricData{M: &supplierv1.MetricData_SupplierById{
		SupplierById: &supplierv1.SupplierMetricByID{Items: items},
	}}, nil
}

func (s *Service) metricDataByDay(
	ctx context.Context,
	scope metricScope,
	groupBy analytic_basev1.GroupType,
	group metricGroup,
	keys *analytic_basev1.MetricKeys,
) (*supplierv1.MetricData, error) {
	if keys.GetDays() == nil {
		return nil, invalid("%s is keyed by days", groupBy)
	}

	days := keys.GetDays().GetDays()
	items := make(map[string]*supplierv1.SupplierMetric, len(days))

	for _, raw := range days {
		day, err := parseDate(raw)
		if err != nil {
			return nil, err
		}

		// A period is keyed by its FIRST day — any other day of it names no row, and would come back as a quiet zero.
		if !bucketStart(groupBy, day).Equal(day) {
			return nil, invalid("%s is not the first day of its %s period", raw, groupBy)
		}

		items[raw] = metricToProto(supplier_service_models.SupplierFigureSums{})
	}

	if len(days) > 0 {
		type row struct {
			Key time.Time
			supplier_service_models.SupplierFigureSums
		}

		db := s.db.WithContext(ctx)
		sums := map[string]supplier_service_models.SupplierFigureSums{}

		for _, read := range []struct {
			from *gorm.DB
			sums string
		}{
			{scope.rows(db), figureSums("r")},
			{scope.salesRows(db), salesSums("r")},
		} {
			var rows []row

			err := read.from.
				Where(group.key+" IN ?", days).
				Select(group.key + " AS key, " + read.sums).
				Group(group.key).
				Scan(&rows).
				Error
			if err != nil {
				return nil, internal(err)
			}

			for _, r := range rows {
				key := r.Key.Format(dateLayout)
				sums[key] = withSales(addRestock(sums[key], r.SupplierFigureSums), r.SupplierFigureSums)
			}
		}

		for key, sum := range sums {
			items[key] = metricToProto(sum)
		}
	}

	return &supplierv1.MetricData{M: &supplierv1.MetricData_SupplierByDay{
		SupplierByDay: &supplierv1.SupplierMetricByDay{Items: items},
	}}, nil
}
