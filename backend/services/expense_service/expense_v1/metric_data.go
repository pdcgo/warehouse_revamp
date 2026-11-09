package expense_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
)

// MetricData FILLS the keys a search returned with Ads expense and/or Expenses — or, grouped by SUMMARY with no keys,
// reads the headline: the same figures over the whole scope (the-headline-is-the-metric-grouped-by-summary).
//
//   - The filters scope the numbers, never the keys (the-fill-step-scopes-its-numbers-by-the-filters): every asked key
//     comes back, one with nothing all zero — never missing.
//   - THE HEADLINE EQUALS THE ROWS (the-expense-prototype-is-accepted): `rows_group` names the table's group, and under
//     an id group the headline counts only the entries that group has a key for — by Seller only sellers' expenses, by
//     Warehouse only warehouses'. Unset, or a time group, every expense the reader can see.
//   - A correction counts on the day it was made, for who made it (an-expense-correction-counts-on-the-day-it-is-made,
//     an-expense-correction-counts-for-who-made-it) — the report holds it there; this read only sums.
//   - `as_of_unix` is the read's own time: the report is written in the expense's own transaction, so it never lags.
//
// ONE statement for every asked metric: the five sums, grouped by the key (or not at all, for the headline); Ads
// expense's `amount` is the ADS sum. Asked alone, Ads expense reads the ADS rows only.
func (s *Service) MetricData(
	ctx context.Context,
	req *connect.Request[expensev1.MetricDataRequest],
) (*connect.Response[expensev1.MetricDataResponse], error) {
	msg := req.Msg

	metrics := make([]expenseMetric, 0, len(msg.GetMetricIds()))

	for _, id := range msg.GetMetricIds() {
		metric, err := metricOf(id)
		if err != nil {
			return nil, err
		}

		metrics = append(metrics, metric)
	}

	if len(metrics) == 0 {
		return nil, invalidMetric("no metric asked")
	}

	filters, err := parseMetricFilters(metrics, msg.GetFilters())
	if err != nil {
		return nil, err
	}

	reader := metricReaderOf(msg.GetTeamId())
	rows := metricRows(s.db.WithContext(ctx), reader, filters, allAds(metrics))

	var datas []*expensev1.MetricData

	if msg.GetGroupBy() == analytic_basev1.GroupType_GROUP_TYPE_SUMMARY {
		datas, err = metricSummary(rows, metrics, msg.GetRowsGroup(), msg.GetKeys())
	} else {
		if msg.GetRowsGroup() != analytic_basev1.GroupType_GROUP_TYPE_UNSPECIFIED {
			return nil, invalidMetric("rows_group is the headline's — a %s read is the rows themselves", msg.GetGroupBy())
		}

		datas, err = metricByKey(rows, metrics, msg.GetGroupBy(), msg.GetKeys())
	}

	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&expensev1.MetricDataResponse{MetricDatas: datas, AsOfUnix: time.Now().Unix()}), nil
}

// metricSummary is the headline — one answer per asked metric, in the asked order (one-call-answers-every-asked-metric).
func metricSummary(
	rows *gorm.DB,
	metrics []expenseMetric,
	rowsGroup analytic_basev1.GroupType,
	keys *analytic_basev1.MetricKeys,
) ([]*expensev1.MetricData, error) {
	if keys.GetK() != nil {
		return nil, invalidMetric("a summary takes no keys")
	}

	// Under an id group, only the entries that group has a key for — the rows' own sum.
	switch rowsGroup {
	case analytic_basev1.GroupType_GROUP_TYPE_UNSPECIFIED, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY:
	default:
		key, err := metricKeyOf(metrics, rowsGroup)
		if err != nil {
			return nil, err
		}

		if !key.isDay {
			rows = rows.Where(key.sql + " <> 0")
		}
	}

	var sums MetricSums

	err := rows.Select(metricSums).Scan(&sums).Error
	if err != nil {
		return nil, metricDBError(err)
	}

	datas := make([]*expensev1.MetricData, 0, len(metrics))

	for _, m := range metrics {
		if m.adsOnly {
			datas = append(datas, &expensev1.MetricData{M: &expensev1.MetricData_AdsSummary{AdsSummary: sums.adsMessage()}})
		} else {
			datas = append(datas, &expensev1.MetricData{
				M: &expensev1.MetricData_ExpensesSummary{ExpensesSummary: sums.expensesMessage()},
			})
		}
	}

	return datas, nil
}

type metricDayRow struct {
	Key time.Time
	MetricSums
}

type metricIDRow struct {
	Key uint64
	MetricSums
}

// metricByKey fills every asked key, for every asked metric.
func metricByKey(
	rows *gorm.DB,
	metrics []expenseMetric,
	group analytic_basev1.GroupType,
	keys *analytic_basev1.MetricKeys,
) ([]*expensev1.MetricData, error) {
	key, err := metricKeyOf(metrics, group)
	if err != nil {
		return nil, err
	}

	query := rows.
		Select(key.sql + " AS key, " + metricSums).
		Group(key.sql)

	if key.isDay {
		if keys.GetDays() == nil {
			return nil, invalidMetric("%s is keyed by days", group)
		}

		days := keys.GetDays().GetDays()
		sums := make(map[string]MetricSums, len(days))

		for _, raw := range days {
			day, err := time.Parse(dateLayout, raw)
			if err != nil {
				return nil, invalidMetric("%q is not a day", raw)
			}

			// A period is keyed by its FIRST day — any other day names no row, and would come back a quiet zero.
			if !metricPeriodStart(group, day).Equal(day) {
				return nil, invalidMetric("%s is not the first day of its %s period", raw, group)
			}

			// Every asked key, zero where nothing was spent — never missing.
			sums[raw] = MetricSums{}
		}

		if len(days) > 0 {
			var found []metricDayRow

			err = query.Where(key.sql+" IN ?", days).Scan(&found).Error
			if err != nil {
				return nil, metricDBError(err)
			}

			for _, row := range found {
				sums[row.Key.Format(dateLayout)] = row.MetricSums
			}
		}

		datas := make([]*expensev1.MetricData, 0, len(metrics))

		for _, m := range metrics {
			if m.adsOnly {
				items := make(map[string]*expensev1.AdsExpenseMetric, len(sums))
				for k, v := range sums {
					items[k] = v.adsMessage()
				}

				datas = append(datas, &expensev1.MetricData{
					M: &expensev1.MetricData_AdsByDay{AdsByDay: &expensev1.AdsExpenseMetricByDay{Items: items}},
				})
			} else {
				items := make(map[string]*expensev1.ExpensesMetric, len(sums))
				for k, v := range sums {
					items[k] = v.expensesMessage()
				}

				datas = append(datas, &expensev1.MetricData{
					M: &expensev1.MetricData_ExpensesByDay{ExpensesByDay: &expensev1.ExpensesMetricByDay{Items: items}},
				})
			}
		}

		return datas, nil
	}

	if keys.GetIds() == nil {
		return nil, invalidMetric("%s is keyed by ids", group)
	}

	ids := keys.GetIds().GetIds()
	sums := make(map[uint64]MetricSums, len(ids))

	for _, id := range ids {
		sums[id] = MetricSums{}
	}

	if len(ids) > 0 {
		var found []metricIDRow

		err = query.Where(key.sql+" IN ?", ids).Scan(&found).Error
		if err != nil {
			return nil, metricDBError(err)
		}

		for _, row := range found {
			sums[row.Key] = row.MetricSums
		}
	}

	datas := make([]*expensev1.MetricData, 0, len(metrics))

	for _, m := range metrics {
		if m.adsOnly {
			items := make(map[uint64]*expensev1.AdsExpenseMetric, len(sums))
			for k, v := range sums {
				items[k] = v.adsMessage()
			}

			datas = append(datas, &expensev1.MetricData{
				M: &expensev1.MetricData_AdsById{AdsById: &expensev1.AdsExpenseMetricByID{Items: items}},
			})
		} else {
			items := make(map[uint64]*expensev1.ExpensesMetric, len(sums))
			for k, v := range sums {
				items[k] = v.expensesMessage()
			}

			datas = append(datas, &expensev1.MetricData{
				M: &expensev1.MetricData_ExpensesById{ExpensesById: &expensev1.ExpensesMetricByID{Items: items}},
			})
		}
	}

	return datas, nil
}
