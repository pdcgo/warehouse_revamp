package financial_account_v1

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// AnalyticTimeSearch serves a series — daily, monthly or yearly — for the team, or one account.
//
// ⚠ EVERY BUCKET IS A POINT, a quiet one included: its movement is zero and its balance carried from the last
// row before it. A coarser grain is rolled up from the daily rows at read, never a table of its own.
func (s *Service) AnalyticTimeSearch(
	ctx context.Context,
	req *connect.Request[financial_accountv1.AnalyticTimeSearchRequest],
) (*connect.Response[financial_accountv1.AnalyticTimeSearchResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()

	start, end, err := parseRange(filter.GetDateRange())
	if err != nil {
		return nil, err
	}

	all, err := timeBuckets(msg.GetTimeframe(), start, end)
	if err != nil {
		return nil, err
	}

	descending := msg.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_DESC
	if descending {
		for i, j := 0, len(all)-1; i < j; i, j = i+1, j-1 {
			all[i], all[j] = all[j], all[i]
		}
	}

	limit, offset := pageWindow(msg.GetPage().GetPage(), msg.GetPage().GetLimit())

	window := []bucket{}
	if offset < len(all) {
		window = all[offset:min(offset+limit, len(all))]
	}

	datas := make([]*financial_accountv1.TimeframeMetric, 0, len(window))

	if len(window) > 0 {
		rows, err := s.timeSeries(ctx, msg.GetTeamId(), filter.GetAccountId(), window, descending)
		if err != nil {
			return nil, err
		}

		for i := range rows {
			// OPEN IS DERIVED, exactly: the close at the bucket's end minus the bucket's movement.
			rows[i].OpenBalance = rows[i].CloseBalance - rows[i].Change

			datas = append(datas, &financial_accountv1.TimeframeMetric{
				At:     rows[i].At,
				Metric: metricToProto(rows[i].MetricColumns),
			})
		}
	}

	return connect.NewResponse(&financial_accountv1.AnalyticTimeSearchResponse{
		Datas: datas,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: max(msg.GetPage().GetPage(), 1),
			TotalPage:   totalPages(int64(len(all)), uint32(limit)),
			TotalItems:  uint64(len(all)),
		},
	}), nil
}

type timeSeriesRow struct {
	At string
	m.MetricColumns
}

// timeSeries reads one page of buckets in ONE statement: each bucket's movement, and its balance as the sum of
// every account's last close at or before the bucket's last day.
func (s *Service) timeSeries(
	ctx context.Context,
	teamID, accountID uint64,
	window []bucket,
	descending bool,
) ([]timeSeriesRow, error) {
	ats := make([]time.Time, 0, len(window))
	froms := make([]time.Time, 0, len(window))
	tos := make([]time.Time, 0, len(window))

	for _, b := range window {
		ats = append(ats, b.at)
		froms = append(froms, b.from)
		tos = append(tos, b.to)
	}

	args := map[string]any{
		"team":    teamID,
		"account": accountID,
		"ats":     dateArray(ats),
		"froms":   dateArray(froms),
		"tos":     dateArray(tos),
	}

	scope := "r.team_id = @team"
	if accountID != 0 {
		scope += " AND r.account_id = @account"
	}

	direction := "ASC"
	if descending {
		direction = "DESC"
	}

	query := fmt.Sprintf(`
SELECT to_char(b.at, 'YYYY-MM-DD') AS at, %[2]s, COALESCE(c.close_balance, 0) AS close_balance
FROM unnest(CAST(@ats AS date[]), CAST(@froms AS date[]), CAST(@tos AS date[])) AS b(at, bucket_from, bucket_to)
LEFT JOIN LATERAL (
    SELECT %[3]s
    FROM financial_account_daily_reports r
    WHERE %[1]s AND r.day BETWEEN b.bucket_from AND b.bucket_to
) mv ON TRUE
LEFT JOIN LATERAL (
    SELECT SUM(x.close_balance) AS close_balance
    FROM (
        SELECT DISTINCT ON (r.account_id) r.close_balance
        FROM financial_account_daily_reports r
        WHERE %[1]s AND r.day <= b.bucket_to
        ORDER BY r.account_id, r.day DESC
    ) x
) c ON TRUE
ORDER BY b.at %[4]s`, scope, movementsFrom("mv"), movementSums("r"), direction)

	rows := []timeSeriesRow{}

	err := s.db.WithContext(ctx).Raw(query, args).Scan(&rows).Error
	if err != nil {
		return nil, dbError(err)
	}

	return rows, nil
}
