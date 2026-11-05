package inventory_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// MetricData FILLS the keys a search returned with Lost stock — or, grouped by SUMMARY with no keys, reads the headline:
// the same figures over the whole scope (the-headline-is-the-metric-grouped-by-summary).
//
//   - The filters scope the numbers, never the keys (the-fill-step-scopes-its-numbers-by-the-filters): every asked key
//     comes back, one with no loss all zero — never missing.
//   - Both fields for every reader (a-warehouse-sees-its-lost-amount).
//   - `as_of_unix` is the read's own time: the report is written in the loss's own transaction, so it never lags.
//
// ONE statement: grouped by the key (or not at all, for the headline).
func (s *Service) MetricData(
	ctx context.Context,
	req *connect.Request[inventoryv1.MetricDataRequest],
) (*connect.Response[inventoryv1.MetricDataResponse], error) {
	msg := req.Msg

	for _, id := range msg.GetMetricIds() {
		err := checkLostMetric(id)
		if err != nil {
			return nil, err
		}
	}

	filters, err := parseLostFilters(msg.GetFilters())
	if err != nil {
		return nil, err
	}

	reader := lostReaderOf(msg.GetTeamId())

	var data *inventoryv1.MetricData

	if msg.GetGroupBy() == analytic_basev1.GroupType_GROUP_TYPE_SUMMARY {
		data, err = s.lostSummary(ctx, reader, filters, msg.GetKeys())
	} else {
		data, err = s.lostByKey(ctx, reader, filters, msg.GetGroupBy(), msg.GetKeys())
	}

	if err != nil {
		return nil, err
	}

	// One answer per asked metric, in the asked order (one-call-answers-every-asked-metric) — one metric, so one each.
	datas := make([]*inventoryv1.MetricData, 0, len(msg.GetMetricIds()))
	for range msg.GetMetricIds() {
		datas = append(datas, data)
	}

	return connect.NewResponse(&inventoryv1.MetricDataResponse{MetricDatas: datas, AsOfUnix: time.Now().Unix()}), nil
}

func (s *Service) lostSummary(
	ctx context.Context,
	reader lostReader,
	filters lostFilters,
	keys *analytic_basev1.MetricKeys,
) (*inventoryv1.MetricData, error) {
	if keys.GetK() != nil {
		return nil, invalidLost("a summary takes no keys")
	}

	var sums LostSums

	err := lostRows(s.db.WithContext(ctx), reader, filters).Select(lostSums).Scan(&sums).Error
	if err != nil {
		return nil, lostDBError(err)
	}

	return &inventoryv1.MetricData{M: &inventoryv1.MetricData_LostSummary{LostSummary: sums.message()}}, nil
}

type lostDayRow struct {
	Key time.Time
	LostSums
}

type lostIDRow struct {
	Key uint64
	LostSums
}

func (s *Service) lostByKey(
	ctx context.Context,
	reader lostReader,
	filters lostFilters,
	group analytic_basev1.GroupType,
	keys *analytic_basev1.MetricKeys,
) (*inventoryv1.MetricData, error) {
	key, err := lostKeyOf(group)
	if err != nil {
		return nil, err
	}

	query := lostRows(s.db.WithContext(ctx), reader, filters).
		Select(key.sql + " AS key, " + lostSums).
		Group(key.sql)

	if key.isDay {
		if keys.GetDays() == nil {
			return nil, invalidLost("%s is keyed by days", group)
		}

		days := keys.GetDays().GetDays()
		items := make(map[string]*inventoryv1.InventoryLostMetric, len(days))

		for _, raw := range days {
			day, err := time.Parse(lostDateLayout, raw)
			if err != nil {
				return nil, invalidLost("%q is not a day", raw)
			}

			// A period is keyed by its FIRST day — any other day names no row, and would come back a quiet zero.
			if !lostPeriodStart(group, day).Equal(day) {
				return nil, invalidLost("%s is not the first day of its %s period", raw, group)
			}

			// Every asked key, zero where nothing was lost — never missing.
			items[raw] = LostSums{}.message()
		}

		if len(days) > 0 {
			var rows []lostDayRow

			err = query.Where(key.sql+" IN ?", days).Scan(&rows).Error
			if err != nil {
				return nil, lostDBError(err)
			}

			for _, row := range rows {
				items[row.Key.Format(lostDateLayout)] = row.LostSums.message()
			}
		}

		return &inventoryv1.MetricData{M: &inventoryv1.MetricData_LostByDay{
			LostByDay: &inventoryv1.InventoryLostMetricByDay{Items: items},
		}}, nil
	}

	if keys.GetIds() == nil {
		return nil, invalidLost("%s is keyed by ids", group)
	}

	ids := keys.GetIds().GetIds()
	items := make(map[uint64]*inventoryv1.InventoryLostMetric, len(ids))

	for _, id := range ids {
		items[id] = LostSums{}.message()
	}

	if len(ids) > 0 {
		var rows []lostIDRow

		err = query.Where(key.sql+" IN ?", ids).Scan(&rows).Error
		if err != nil {
			return nil, lostDBError(err)
		}

		for _, row := range rows {
			items[row.Key] = row.LostSums.message()
		}
	}

	return &inventoryv1.MetricData{M: &inventoryv1.MetricData_LostById{
		LostById: &inventoryv1.InventoryLostMetricByID{Items: items},
	}}, nil
}
