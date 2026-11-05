package financial_account_v1

import (
	"cmp"
	"context"
	"slices"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_metric"
)

// MetricSearch RANKS the keys of one page of a report table by a field of ONE Finance metric — accounts, providers,
// change types or periods (docs/business/analytic/rpc_provide.md).
//
//   - An ACCOUNT group holds every account of the team with a row up to the window's END, a quiet one included; a
//     PROVIDER group the providers of those accounts; a CHANGE_TYPE group every type that moved in the window; a time
//     group every period of the window.
//   - It ranks by the SAME figures the fill answers with (the message's own field), so the order and the numbers agree.
//   - No total: it says whether another page follows (a-page-says-whether-another-follows).
//
// The keys are few — a team's accounts, six providers, nine types, at most 366 days — so every key's figures are read
// (two statements at most, the-balance-series-is-a-running-sum) and ranked here.
func (s *Service) MetricSearch(
	ctx context.Context,
	req *connect.Request[financial_accountv1.MetricSearchRequest],
) (*connect.Response[financial_accountv1.MetricSearchResponse], error) {
	msg := req.Msg

	metric, err := financeMetricByID(msg.GetSort().GetMetricId())
	if err != nil {
		return nil, err
	}

	metrics := []*financeMetric{metric}

	filters, err := parseMetricFilters(msg.GetFilters(), metrics)
	if err != nil {
		return nil, err
	}

	group := msg.GetGroupBy()

	err = checkGroup(group, metrics)
	if err != nil {
		return nil, err
	}

	field, _, err := san_metric.SortField(metric.desc, msg.GetSort().GetField())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	// An unspecified sort reads DESC.
	ascending := msg.GetSort().GetSortType() == analytic_basev1.SortType_SORT_TYPE_ASC
	valueOf := func(f figures) float64 {
		return metric.messageOf(f).ProtoReflect().Get(field).Float()
	}

	offset, limit := int(msg.GetPage().GetOffset()), int(msg.GetPage().GetLimit())
	keys := &analytic_basev1.MetricKeys{}

	var hasNext bool

	if isTimeGroup(group) {
		periods, err := s.series(ctx, msg.GetTeamId(), group, filters)
		if err != nil {
			return nil, err
		}

		ranked := rank(periods, func(p period) float64 { return valueOf(p.figures) },
			func(a, b period) int { return cmp.Compare(a.key, b.key) }, ascending)

		page, next := pageOf(ranked, offset, limit)
		hasNext = next

		days := make([]string, 0, len(page))
		for _, p := range page {
			days = append(days, p.key)
		}

		keys.K = &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: days}}
	} else {
		rows, err := s.byAccount(ctx, msg.GetTeamId(), filters)
		if err != nil {
			return nil, err
		}

		all, err := idKeys(group, rows)
		if err != nil {
			return nil, err
		}

		ranked := rank(all, func(k keyed) float64 { return valueOf(k.figures) },
			func(a, b keyed) int { return cmp.Compare(a.id, b.id) }, ascending)

		page, next := pageOf(ranked, offset, limit)
		hasNext = next

		ids := make([]uint64, 0, len(page))
		for _, k := range page {
			ids = append(ids, k.id)
		}

		keys.K = &analytic_basev1.MetricKeys_Ids{Ids: &analytic_basev1.IDList{Ids: ids}}
	}

	return connect.NewResponse(&financial_accountv1.MetricSearchResponse{Keys: keys, HasNext: hasNext}), nil
}

// rank orders keys by a value, and the key DESC breaks every tie (the-key-breaks-every-tie) — whichever way the value
// is sorted.
func rank[T any](items []T, value func(T) float64, byKey func(a, b T) int, ascending bool) []T {
	out := slices.Clone(items)

	slices.SortStableFunc(out, func(a, b T) int {
		c := cmp.Compare(value(a), value(b))
		if !ascending {
			c = -c
		}

		if c != 0 {
			return c
		}

		return -byKey(a, b)
	})

	return out
}

// pageOf cuts a page and says whether another follows.
func pageOf[T any](items []T, offset, limit int) ([]T, bool) {
	if offset >= len(items) {
		return nil, false
	}

	end := min(offset+limit, len(items))

	return items[offset:end], end < len(items)
}
