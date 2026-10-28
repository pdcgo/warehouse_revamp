package supplier_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"

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
// ONE statement.
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

	return connect.NewResponse(&supplierv1.MetricDataResponse{MetricDatas: datas}), nil
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

		var total supplier_service_models.SupplierMetricColumns

		err := scope.rows(db).Select(figureSums("r")).Scan(&total).Error
		if err != nil {
			return nil, internal(err)
		}

		return &supplierv1.MetricData{M: &supplierv1.MetricData_SupplierSummary{SupplierSummary: metricToProto(total)}}, nil
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
		items[id] = metricToProto(supplier_service_models.SupplierMetricColumns{})
	}

	if len(ids) > 0 {
		type row struct {
			Key uint64
			supplier_service_models.SupplierMetricColumns
		}

		var rows []row

		err = scope.rows(db).
			Where(group.key+" IN ?", ids).
			Select(group.key + " AS key, " + figureSums("r")).
			Group(group.key).
			Scan(&rows).
			Error
		if err != nil {
			return nil, internal(err)
		}

		for _, r := range rows {
			items[r.Key] = metricToProto(r.SupplierMetricColumns)
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

		items[raw] = metricToProto(supplier_service_models.SupplierMetricColumns{})
	}

	if len(days) > 0 {
		type row struct {
			Key time.Time
			supplier_service_models.SupplierMetricColumns
		}

		var rows []row

		err := scope.rows(s.db.WithContext(ctx)).
			Where(group.key+" IN ?", days).
			Select(group.key + " AS key, " + figureSums("r")).
			Group(group.key).
			Scan(&rows).
			Error
		if err != nil {
			return nil, internal(err)
		}

		for _, r := range rows {
			items[r.Key.Format(dateLayout)] = metricToProto(r.SupplierMetricColumns)
		}
	}

	return &supplierv1.MetricData{M: &supplierv1.MetricData_SupplierByDay{
		SupplierByDay: &supplierv1.SupplierMetricByDay{Items: items},
	}}, nil
}
