package settlement_v1

import (
	"context"

	"connectrpc.com/connect"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// AnalyticGroupMetric fills a page of groups the caller already ranked with AnalyticGroupSearch.
//
// It reads the SAME metric definition the search ranked by (groupMetricsCTE), so the order on screen and
// the numbers beside it are one computation.
//
// ⚠ AN ID WITH NO POSITION STILL GETS A METRIC, all zeros — absent from the map would read as a failed
// lookup rather than a group that never moved.
func (s *Service) AnalyticGroupMetric(
	ctx context.Context,
	req *connect.Request[settlementv1.AnalyticGroupMetricRequest],
) (*connect.Response[settlementv1.AnalyticGroupMetricResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()

	start, end, err := parseRange(filter.GetDateRange())
	if err != nil {
		return nil, err
	}

	grain, key, err := groupSpecOf(filter.GetGroupType())
	if err != nil {
		return nil, err
	}

	args := map[string]any{
		"start": start.Format(dateLayout),
		"end":   end.Format(dateLayout),
		"ids":   idArray(msg.GetIds()),
	}

	query := groupMetricsCTE(grain, key, groupScope(msg.GetTeamId(), args)) + `
SELECT * FROM metrics WHERE gid = ANY(CAST(@ids AS bigint[]))`

	rows := []groupMetricRow{}

	err = s.db.WithContext(ctx).Raw(query, args).Scan(&rows).Error
	if err != nil {
		return nil, dbError(err)
	}

	metrics := make(map[uint64]*settlementv1.SettlementMetric, len(msg.GetIds()))

	for _, id := range msg.GetIds() {
		metrics[id] = metricToProto(settlement_service_models.SettlementMetricColumns{})
	}

	for i := range rows {
		metrics[rows[i].Gid] = metricToProto(rows[i].SettlementMetricColumns)
	}

	return connect.NewResponse(&settlementv1.AnalyticGroupMetricResponse{Metrics: metrics}), nil
}
