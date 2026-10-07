package settlement_v1

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
)

// AnalyticGroupSearch RANKS groups — teams, shops or users — over a window, and returns ids only
// (analytic_context.md §How We Handle Grouped Metric). The caller fills the page with
// AnalyticGroupMetric.
//
// ⚠ TEAM crosses team scope only from the ROOT team, the one scope ROOT and ADMIN hold. From any other
// scope every grouping is restricted to that team, because a team user is never authorised past it.
func (s *Service) AnalyticGroupSearch(
	ctx context.Context,
	req *connect.Request[settlementv1.AnalyticGroupSearchRequest],
) (*connect.Response[settlementv1.AnalyticGroupSearchResponse], error) {
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
	}

	cte := groupMetricsCTE(grain, key, groupScope(msg.GetTeamId(), args))

	var total int64

	err = s.db.WithContext(ctx).Raw(cte+` SELECT COUNT(*) FROM metrics`, args).Scan(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	column, ok := metricSortColumn[msg.GetSort()]
	if !ok {
		// The default ranks by the shortfall each group carries.
		column = "close_balance"
	}

	// ASCENDING unless asked otherwise — on a balance, most negative first, which is the largest loss.
	direction := "ASC"
	if msg.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_DESC {
		direction = "DESC"
	}

	page := msg.GetPage()
	args["limit"] = page.GetLimit()
	args["offset"] = (page.GetPage() - 1) * page.GetLimit()

	ids := []uint64{}

	// The id breaks ties, so a page boundary never shuffles two equal groups between requests.
	query := cte + fmt.Sprintf(`
SELECT gid FROM metrics
ORDER BY %s %s, gid ASC
LIMIT @limit OFFSET @offset`, column, direction)

	err = s.db.WithContext(ctx).Raw(query, args).Scan(&ids).Error
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&settlementv1.AnalyticGroupSearchResponse{
		Ids: ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
