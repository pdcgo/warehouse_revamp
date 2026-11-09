package financial_account_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

// MetricData FILLS the keys a search returned with every asked Finance metric — or, grouped by SUMMARY with no keys,
// reads the headline: the same figures over the whole window (the-headline-is-the-metric-grouped-by-summary).
//
//   - The filters scope the numbers, never the keys (the-fill-step-scopes-its-numbers-by-the-filters): every asked key
//     comes back for every asked metric. An id with nothing up to the window's end is zero, and so is a period outside
//     the window. A quiet period or a quiet account carries its balance.
//   - `opening_balance` and `closing_balance` are POSITIONS (a-position-is-its-own-stat-type) — read as one running sum
//     (the-balance-series-is-a-running-sum), never summed over periods. The headline's are the window's two edges.
//   - One answer per asked metric, in the asked order (one-call-answers-every-asked-metric).
func (s *Service) MetricData(
	ctx context.Context,
	req *connect.Request[financial_accountv1.MetricDataRequest],
) (*connect.Response[financial_accountv1.MetricDataResponse], error) {
	msg := req.Msg

	metrics := make([]*financeMetric, 0, len(msg.GetMetricIds()))

	for _, id := range msg.GetMetricIds() {
		metric, err := financeMetricByID(id)
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

	keys := msg.GetKeys()
	teamID := msg.GetTeamId()

	// The daily rows are written in the log row's own transaction, so the figures are as of the moment they are read.
	asOf := s.now().Unix()

	switch {
	case group == analytic_basev1.GroupType_GROUP_TYPE_SUMMARY:
		if keys.GetK() != nil {
			return nil, invalidMetric("a summary takes no keys")
		}

		rows, err := s.byAccount(ctx, teamID, filters)
		if err != nil {
			return nil, err
		}

		total := summaryOf(rows)

		return answer(asOf, metrics, func(metric *financeMetric) *financial_accountv1.MetricData {
			if metric == metricChanges {
				return &financial_accountv1.MetricData{M: &financial_accountv1.MetricData_ChangesSummary{ChangesSummary: changesOf(total)}}
			}

			return &financial_accountv1.MetricData{M: &financial_accountv1.MetricData_TypesSummary{TypesSummary: typesOf(total)}}
		}), nil

	case isTimeGroup(group):
		if keys.GetDays() == nil {
			return nil, invalidMetric("%s is keyed by days", group)
		}

		asked := keys.GetDays().GetDays()

		for _, text := range asked {
			day, err := time.Parse(dateLayout, text)
			if err != nil {
				return nil, invalidMetric("%q is not a day", text)
			}

			if !periodStart(group, day).Equal(day) {
				return nil, invalidMetric("%s is not the first day of its %s period", text, group)
			}
		}

		// The whole window's running sum — a page's balances depend on every period before it.
		filled := map[string]figures{}

		if len(asked) > 0 {
			periods, err := s.series(ctx, teamID, group, filters)
			if err != nil {
				return nil, err
			}

			for _, p := range periods {
				filled[p.key] = p.figures
			}
		}

		return answer(asOf, metrics, func(metric *financeMetric) *financial_accountv1.MetricData {
			if metric == metricChanges {
				items := make(map[string]*financial_accountv1.AccountChangeMetric, len(asked))
				for _, key := range asked {
					items[key] = changesOf(filled[key])
				}

				return &financial_accountv1.MetricData{M: &financial_accountv1.MetricData_ChangesByDay{
					ChangesByDay: &financial_accountv1.AccountChangeMetricByDay{Items: items},
				}}
			}

			items := make(map[string]*financial_accountv1.AccountChangeTypeMetric, len(asked))
			for _, key := range asked {
				items[key] = typesOf(filled[key])
			}

			return &financial_accountv1.MetricData{M: &financial_accountv1.MetricData_TypesByDay{
				TypesByDay: &financial_accountv1.AccountChangeTypeMetricByDay{Items: items},
			}}
		}), nil

	default:
		if keys.GetIds() == nil {
			return nil, invalidMetric("%s is keyed by ids", group)
		}

		asked := keys.GetIds().GetIds()
		filled := map[uint64]figures{}

		if len(asked) > 0 {
			rows, err := s.byAccount(ctx, teamID, filters)
			if err != nil {
				return nil, err
			}

			all, err := idKeys(group, rows)
			if err != nil {
				return nil, err
			}

			for _, k := range all {
				filled[k.id] = k.figures
			}
		}

		return answer(asOf, metrics, func(metric *financeMetric) *financial_accountv1.MetricData {
			if metric == metricChanges {
				items := make(map[uint64]*financial_accountv1.AccountChangeMetric, len(asked))
				for _, id := range asked {
					items[id] = changesOf(filled[id])
				}

				return &financial_accountv1.MetricData{M: &financial_accountv1.MetricData_ChangesById{
					ChangesById: &financial_accountv1.AccountChangeMetricByID{Items: items},
				}}
			}

			items := make(map[uint64]*financial_accountv1.AccountChangeTypeMetric, len(asked))
			for _, id := range asked {
				items[id] = typesOf(filled[id])
			}

			return &financial_accountv1.MetricData{M: &financial_accountv1.MetricData_TypesById{
				TypesById: &financial_accountv1.AccountChangeTypeMetricByID{Items: items},
			}}
		}), nil
	}
}

// answer is one MetricData per asked metric, in the asked order, and the as-of time.
func answer(
	asOf int64,
	metrics []*financeMetric,
	dataOf func(*financeMetric) *financial_accountv1.MetricData,
) *connect.Response[financial_accountv1.MetricDataResponse] {
	datas := make([]*financial_accountv1.MetricData, 0, len(metrics))
	for _, metric := range metrics {
		datas = append(datas, dataOf(metric))
	}

	return connect.NewResponse(&financial_accountv1.MetricDataResponse{MetricDatas: datas, AsOfUnix: asOf})
}
