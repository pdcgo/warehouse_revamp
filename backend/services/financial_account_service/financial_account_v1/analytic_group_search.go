package financial_account_v1

import (
	"context"
	"math"
	"sort"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
)

// AnalyticGroupSearch RANKS the groups — accounts, providers or change types — over a window, and pages
// them. Keys only; AnalyticGroupMetric fills the page. Two calls by design (analytic_context.md §How We
// Handle Grouped Metric), so the order and the numbers beside it come from one definition.
//
// The default rank is the largest movement first, by absolute value; CLOSE_BALANCE ranks by the balance at the
// window's end. ASC reverses either. The key is the tie-break, so a page never shuffles.
func (s *Service) AnalyticGroupSearch(
	ctx context.Context,
	req *connect.Request[financial_accountv1.AnalyticGroupSearchRequest],
) (*connect.Response[financial_accountv1.AnalyticGroupSearchResponse], error) {
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

	byBalance := msg.GetSort() == financial_accountv1.AnalyticMetricSort_ANALYTIC_METRIC_SORT_CLOSE_BALANCE
	ascending := msg.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_ASC

	sort.SliceStable(groups, func(i, j int) bool {
		a, b := math.Abs(groups[i].metric.Change), math.Abs(groups[j].metric.Change)
		if byBalance {
			a, b = groups[i].metric.CloseBalance, groups[j].metric.CloseBalance
		}

		if a == b {
			return groups[i].sortID < groups[j].sortID
		}

		if ascending {
			return a < b
		}

		return a > b
	})

	limit, offset := pageWindow(msg.GetPage().GetPage(), msg.GetPage().GetLimit())

	keys := []*financial_accountv1.AnalyticGroupKey{}
	if offset < len(groups) {
		for _, g := range groups[offset:min(offset+limit, len(groups))] {
			keys = append(keys, g.key)
		}
	}

	return connect.NewResponse(&financial_accountv1.AnalyticGroupSearchResponse{
		Keys: keys,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: max(msg.GetPage().GetPage(), 1),
			TotalPage:   totalPages(int64(len(groups)), uint32(limit)),
			TotalItems:  uint64(len(groups)),
		},
	}), nil
}
