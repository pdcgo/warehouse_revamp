package expense_v1

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_metric"
)

// MetricSearch RANKS the keys of one page of an Ads expense or Expenses table — shops, sellers, warehouses, people or
// periods — by one field of the sorted metric (docs/business/analytic/rpc_provide.md).
//
//   - Only keys with an entry in the scope (the-rows-are-the-keys-step-one-sends): Ads expense's keys are the ads'
//     own, Expenses' every typed kind's. A key whose entries net to 0 (an expense and its cancel) is still a row.
//   - Seller ranks selling teams, Warehouse warehouse teams (the-warehouse-is-its-own-group): a warehouse team's
//     expense is no Seller key, and the root team's neither. Id 0 — no shop, no known person — is never a key.
//   - No total: it reads limit + 1 and says whether another page follows (a-page-says-whether-another-follows).
//
// ONE statement: the scope grouped by the key, ordered, a page plus one.
func (s *Service) MetricSearch(
	ctx context.Context,
	req *connect.Request[expensev1.MetricSearchRequest],
) (*connect.Response[expensev1.MetricSearchResponse], error) {
	msg := req.Msg

	metric, err := metricOf(msg.GetSort().GetMetricId())
	if err != nil {
		return nil, err
	}

	metrics := []expenseMetric{metric}

	filters, err := parseMetricFilters(metrics, msg.GetFilters())
	if err != nil {
		return nil, err
	}

	key, err := metricKeyOf(metrics, msg.GetGroupBy())
	if err != nil {
		return nil, err
	}

	field, _, err := san_metric.SortField(metric.descriptor, msg.GetSort().GetField())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	direction := "DESC"
	if msg.GetSort().GetSortType() == analytic_basev1.SortType_SORT_TYPE_ASC {
		direction = "ASC"
	}

	db := s.db.WithContext(ctx)

	grouped := metricRows(db, metricReaderOf(msg.GetTeamId()), filters, metric.adsOnly).
		Select(key.sql + " AS key, " + metricSums).
		Group(key.sql)
	if !key.isDay {
		grouped = grouped.Where(key.sql + " <> 0")
	}

	page := msg.GetPage()
	limit := int(page.GetLimit())

	query := db.
		Table("(?) AS g", grouped).
		Select("g.key").
		// The key, DESC, breaks every tie (the-key-breaks-every-tie).
		Order(fmt.Sprintf("g.%s %s, g.key DESC", metric.metricColumn(string(field.Name())), direction)).
		Offset(int(page.GetOffset())).
		Limit(limit + 1)

	keys := &analytic_basev1.MetricKeys{}
	hasNext := false

	if key.isDay {
		var days []time.Time

		err = query.Pluck("g.key", &days).Error
		if err != nil {
			return nil, metricDBError(err)
		}

		if len(days) > limit {
			days, hasNext = days[:limit], true
		}

		list := make([]string, 0, len(days))
		for _, day := range days {
			list = append(list, day.Format(dateLayout))
		}

		keys.K = &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: list}}
	} else {
		var ids []uint64

		err = query.Pluck("g.key", &ids).Error
		if err != nil {
			return nil, metricDBError(err)
		}

		if len(ids) > limit {
			ids, hasNext = ids[:limit], true
		}

		keys.K = &analytic_basev1.MetricKeys_Ids{Ids: &analytic_basev1.IDList{Ids: ids}}
	}

	return connect.NewResponse(&expensev1.MetricSearchResponse{Keys: keys, HasNext: hasNext}), nil
}
