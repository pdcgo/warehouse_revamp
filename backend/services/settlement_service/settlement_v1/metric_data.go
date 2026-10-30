package settlement_v1

import (
	"context"
	"strconv"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
)

// MetricData FILLS the keys a search returned with every asked settlement metric — or, grouped by SUMMARY with no
// keys, reads the headline: the same figures over the whole window (the-headline-is-the-metric-grouped-by-summary).
//
//   - The filters scope the numbers, never the keys (the-fill-step-scopes-its-numbers-by-the-filters): every asked key
//     comes back for every asked metric — never missing. An id with no row up to the window's end is zero, and so is a
//     period outside the window. A quiet period inside it carries its position.
//   - One answer per asked metric, in the asked order (one-call-answers-every-asked-metric).
//   - The movement fields are summed over the key's window; `position_to_date` is the position at its END — never a
//     sum over time (a-position-is-its-own-stat-type).
//
// ONE statement for both metrics: every field is selected once, and each metric takes its own.
func (s *Service) MetricData(
	ctx context.Context,
	req *connect.Request[settlementv1.MetricDataRequest],
) (*connect.Response[settlementv1.MetricDataResponse], error) {
	msg := req.Msg

	metrics := make([]*settlementMetric, 0, len(msg.GetMetricIds()))

	for _, id := range msg.GetMetricIds() {
		metric, err := settlementMetricByID(id)
		if err != nil {
			return nil, err
		}

		metrics = append(metrics, metric)
	}

	filters, err := parseMetricFilters(msg.GetFilters(), metrics)
	if err != nil {
		return nil, err
	}

	group := msg.GetGroupBy()

	err = checkGroup(group, metrics)
	if err != nil {
		return nil, err
	}

	grain, err := tableOf(group, filters)
	if err != nil {
		return nil, err
	}

	scope := scopeOf(msg.GetTeamId(), filters)
	keys := msg.GetKeys()

	switch {
	case group == analytic_basev1.GroupType_GROUP_TYPE_SUMMARY:
		if keys.GetK() != nil {
			return nil, invalidMetric("a summary takes no keys")
		}

		rows, err := s.figures(ctx, timeBase(grain, scope, []bucket{{at: filters.start, from: filters.start, to: filters.end}}))
		if err != nil {
			return nil, err
		}

		var row figureRow
		if len(rows) > 0 {
			row = rows[0]
		}

		return answer(metrics, func(metric *settlementMetric) *settlementv1.MetricData {
			if metric == metricSettlement {
				return &settlementv1.MetricData{M: &settlementv1.MetricData_SettlementSummary{SettlementSummary: row.settlement()}}
			}

			return &settlementv1.MetricData{M: &settlementv1.MetricData_TypesSummary{TypesSummary: row.types()}}
		}), nil
	case isTimeGroup(group):
		if keys.GetDays() == nil {
			return nil, invalidMetric("%s is keyed by days", group)
		}

		days, err := parseDays(group, keys.GetDays().GetDays())
		if err != nil {
			return nil, err
		}

		// Only the periods the window meets are read; the rest are zero.
		buckets := []bucket{}

		for _, day := range days {
			b, inWindow := bucketOf(group, day, filters)
			if inWindow {
				buckets = append(buckets, b)
			}
		}

		filled := map[string]figureRow{}

		if len(buckets) > 0 {
			rows, err := s.figures(ctx, timeBase(grain, scope, buckets))
			if err != nil {
				return nil, err
			}

			for _, row := range rows {
				filled[row.Key] = row
			}
		}

		asked := keys.GetDays().GetDays()

		return answer(metrics, func(metric *settlementMetric) *settlementv1.MetricData {
			if metric == metricSettlement {
				items := make(map[string]*settlementv1.SettlementMetric, len(asked))
				for _, key := range asked {
					items[key] = filled[key].settlement()
				}

				return &settlementv1.MetricData{M: &settlementv1.MetricData_SettlementByDay{
					SettlementByDay: &settlementv1.SettlementMetricByDay{Items: items},
				}}
			}

			items := make(map[string]*settlementv1.SettlementTypeMetric, len(asked))
			for _, key := range asked {
				items[key] = filled[key].types()
			}

			return &settlementv1.MetricData{M: &settlementv1.MetricData_TypesByDay{
				TypesByDay: &settlementv1.SettlementTypeMetricByDay{Items: items},
			}}
		}), nil
	default:
		column, ok := idColumnOf(group)
		if !ok {
			return nil, invalidMetric("%s is not a group this service reads", group)
		}

		if keys.GetIds() == nil {
			return nil, invalidMetric("%s is keyed by ids", group)
		}

		asked := keys.GetIds().GetIds()
		filled := map[string]figureRow{}

		if len(asked) > 0 {
			rows, err := s.figures(ctx, idBase(grain, column, scope, filters, asked))
			if err != nil {
				return nil, err
			}

			for _, row := range rows {
				filled[row.Key] = row
			}
		}

		return answer(metrics, func(metric *settlementMetric) *settlementv1.MetricData {
			if metric == metricSettlement {
				items := make(map[uint64]*settlementv1.SettlementMetric, len(asked))
				for _, id := range asked {
					items[id] = filled[strconv.FormatUint(id, 10)].settlement()
				}

				return &settlementv1.MetricData{M: &settlementv1.MetricData_SettlementById{
					SettlementById: &settlementv1.SettlementMetricByID{Items: items},
				}}
			}

			items := make(map[uint64]*settlementv1.SettlementTypeMetric, len(asked))
			for _, id := range asked {
				items[id] = filled[strconv.FormatUint(id, 10)].types()
			}

			return &settlementv1.MetricData{M: &settlementv1.MetricData_TypesById{
				TypesById: &settlementv1.SettlementTypeMetricByID{Items: items},
			}}
		}), nil
	}
}

// figures runs a base and reads every field of every key it holds.
func (s *Service) figures(ctx context.Context, base string) ([]figureRow, error) {
	rows := []figureRow{}

	err := s.db.WithContext(ctx).Raw(base + "\nSELECT " + figureColumns() + " FROM measured").Scan(&rows).Error
	if err != nil {
		return nil, dbError(err)
	}

	return rows, nil
}

// answer is one MetricData per asked metric, in the asked order.
func answer(
	metrics []*settlementMetric,
	dataOf func(*settlementMetric) *settlementv1.MetricData,
) *connect.Response[settlementv1.MetricDataResponse] {
	datas := make([]*settlementv1.MetricData, 0, len(metrics))
	for _, metric := range metrics {
		datas = append(datas, dataOf(metric))
	}

	return connect.NewResponse(&settlementv1.MetricDataResponse{MetricDatas: datas})
}
