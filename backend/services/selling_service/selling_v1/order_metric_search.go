package selling_v1

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_metric"
)

// MetricSearch RANKS the keys of one page of a report table by a field of ONE order metric — sellers, shops,
// warehouses, creators or periods (docs/business/analytic/rpc_provide.md).
//
//   - Only keys with figures in the scope — the rows are the keys this search sends
//     (the-rows-are-the-keys-step-one-sends).
//   - ⚠ An id of 0 — a row with no creator, or none of the others recorded — is LEFT OUT of an id group: the contract
//     cannot send 0 back as a key (IDList's ids are > 0), so a row keyed 0 would be a row nobody can fill.
//   - A warehouse may not sort by money (a-warehouse-sees-no-seller-money): a sort that would rank by figures it is
//     not shown is refused.
//   - No total: it reads limit + 1 and says whether another page follows (a-page-says-whether-another-follows).
//
// ONE statement, after the reader's team type: the scope grouped by the key, ordered, a page plus one.
func (a *Analytic) MetricSearch(
	ctx context.Context,
	req *connect.Request[sellingv1.MetricSearchRequest],
) (*connect.Response[sellingv1.MetricSearchResponse], error) {
	msg := req.Msg

	metric, err := orderMetricByID(msg.GetSort().GetMetricId())
	if err != nil {
		return nil, err
	}

	metrics := []*orderMetric{metric}

	filters, err := parseMetricFilters(msg.GetFilters(), metrics)
	if err != nil {
		return nil, err
	}

	key, err := keyOf(msg.GetGroupBy(), metrics)
	if err != nil {
		return nil, err
	}

	field, _, err := san_metric.SortField(metric.desc, msg.GetSort().GetField())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	reader, err := a.readerOf(ctx, msg.GetTeamId())
	if err != nil {
		return nil, err
	}

	if !reader.money && isMoney(field) {
		return nil, invalidMetric("a warehouse reads the orders it ships without their money — %s cannot be sorted by",
			field.Name())
	}

	direction := "DESC"
	if msg.GetSort().GetSortType() == analytic_basev1.SortType_SORT_TYPE_ASC {
		direction = "ASC"
	}

	db := a.db.WithContext(ctx)

	grouped := reportRows(db, reader, filters, metrics).
		Select(key.sql + " AS key, " + reportSums).
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
		Order(fmt.Sprintf("g.%s %s, g.key DESC", reportColumn[field.Number()], direction)).
		Offset(int(page.GetOffset())).
		Limit(limit + 1)

	keys := &analytic_basev1.MetricKeys{}
	hasNext := false

	if key.isDay {
		var days []time.Time

		err = query.Pluck("g.key", &days).Error
		if err != nil {
			return nil, dbError(err)
		}

		if len(days) > limit {
			days, hasNext = days[:limit], true
		}

		list := make([]string, 0, len(days))
		for _, day := range days {
			list = append(list, day.Format(metricDateLayout))
		}

		keys.K = &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: list}}
	} else {
		var ids []uint64

		err = query.Pluck("g.key", &ids).Error
		if err != nil {
			return nil, dbError(err)
		}

		if len(ids) > limit {
			ids, hasNext = ids[:limit], true
		}

		keys.K = &analytic_basev1.MetricKeys_Ids{Ids: &analytic_basev1.IDList{Ids: ids}}
	}

	return connect.NewResponse(&sellingv1.MetricSearchResponse{Keys: keys, HasNext: hasNext}), nil
}
