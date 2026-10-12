package financial_account_v1

import (
	"context"

	"connectrpc.com/connect"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// AnalyticGroupMetric fills the keys a caller already ranked, in the request's order. A key with no movement
// in the window still gets a metric — its balance carried in from before — and a key with nothing at all, a
// provider the team holds no account of, gets zeros.
//
// For a CHANGE_TYPE key the metric carries that type's column and `change` alone — a balance belongs to an
// account, not to a type.
func (s *Service) AnalyticGroupMetric(
	ctx context.Context,
	req *connect.Request[financial_accountv1.AnalyticGroupMetricRequest],
) (*connect.Response[financial_accountv1.AnalyticGroupMetricResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()

	start, end, err := parseRange(filter.GetDateRange())
	if err != nil {
		return nil, err
	}

	rows, err := windowByAccount(ctx, s.db, msg.GetTeamId(), start, end)
	if err != nil {
		return nil, err
	}

	groups, err := groupsOf(filter.GetGroupType(), rows)
	if err != nil {
		return nil, err
	}

	items := make([]*financial_accountv1.AnalyticGroupMetricItem, 0, len(msg.GetKeys()))

	for _, key := range msg.GetKeys() {
		metric := m.MetricColumns{}

		for _, g := range groups {
			if sameKey(g.key, key) {
				metric = g.metric
				break
			}
		}

		items = append(items, &financial_accountv1.AnalyticGroupMetricItem{Key: key, Metric: metricToProto(metric)})
	}

	return connect.NewResponse(&financial_accountv1.AnalyticGroupMetricResponse{Items: items}), nil
}
