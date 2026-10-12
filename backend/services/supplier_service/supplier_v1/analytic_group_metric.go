package supplier_v1

import (
	"context"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// AnalyticGroupMetric is the six figures of the suppliers a ranking page holds — the ids AnalyticGroupSearch returned,
// over the same window and restocking team. An id with nothing in the window gets an all-zero metric, never a missing
// key. The filter's `q` is not read: the ids are already the search's answer.
//
// ONE query.
func (s *Service) AnalyticGroupMetric(
	ctx context.Context,
	req *connect.Request[supplierv1.AnalyticGroupMetricRequest],
) (*connect.Response[supplierv1.AnalyticGroupMetricResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()

	start, end, err := parseRange(filter.GetDateRange())
	if err != nil {
		return nil, err
	}

	type row struct {
		SupplierID uint64
		supplier_service_models.SupplierMetricColumns
	}

	var rows []row

	err = window(s.db.WithContext(ctx), start, end, filter.GetRestockTeamId()).
		Where("r.supplier_id IN ?", msg.GetIds()).
		Select("r.supplier_id, " + figureSums("r")).
		Group("r.supplier_id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, internal(err)
	}

	metrics := make(map[uint64]*supplierv1.SupplierMetric, len(msg.GetIds()))
	for _, id := range msg.GetIds() {
		metrics[id] = metricToProto(supplier_service_models.SupplierMetricColumns{})
	}

	for _, r := range rows {
		metrics[r.SupplierID] = metricToProto(r.SupplierMetricColumns)
	}

	return connect.NewResponse(&supplierv1.AnalyticGroupMetricResponse{Metrics: metrics}), nil
}
