package settlement_v1

import (
	"context"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// AnalyticTimeSearch serves a metric series — daily, monthly or yearly — read from the folded daily
// tables (analytic_context.md §How We Handle Timeframe Related Metric).
//
// ⚠ EVERY BUCKET IS A POINT, including one with no movement. Its movement is zero and its position is
// carried from the last row before it — a quiet week is not a hole in the shortfall
// (#a-past-date-position-is-a-real-screen).
//
// A coarser grain is ROLLED UP from the daily rows at read, never a table of its own: a second grain is a
// second thing to fold and reconcile.
func (s *Service) AnalyticTimeSearch(
	ctx context.Context,
	req *connect.Request[settlementv1.AnalyticTimeSearchRequest],
) (*connect.Response[settlementv1.AnalyticTimeSearchResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()

	start, end, err := parseRange(filter.GetDateRange())
	if err != nil {
		return nil, err
	}

	if filter.GetUserId() != 0 && filter.GetShopId() != 0 {
		return nil, errUserAndShop
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

	page := msg.GetPage()
	limit := int(page.GetLimit())
	offset := int(page.GetPage()-1) * limit

	window := []bucket{}
	if offset < len(all) {
		window = all[offset:min(offset+limit, len(all))]
	}

	grain := shopDaily
	conditions := []string{}
	args := map[string]any{}

	if !isRootScope(msg.GetTeamId()) {
		conditions = append(conditions, "r.team_id = @team")
		args["team"] = msg.GetTeamId()
	}

	if filter.GetUserId() != 0 {
		grain = userDaily
		conditions = append(conditions, "r.user_id = @subject")
		args["subject"] = filter.GetUserId()
	}

	if filter.GetShopId() != 0 {
		conditions = append(conditions, "r.shop_id = @subject")
		args["subject"] = filter.GetShopId()
	}

	scope := "TRUE"
	if len(conditions) > 0 {
		scope = strings.Join(conditions, " AND ")
	}

	datas := make([]*settlementv1.TimeframeMetric, 0, len(window))

	if len(window) > 0 {
		rows, err := s.timeSeries(ctx, grain, scope, args, window, descending)
		if err != nil {
			return nil, err
		}

		for i := range rows {
			// ⚠ OPEN IS DERIVED, and exactly: per position, the close at the bucket's end minus the
			// bucket's movement IS its close before the bucket — summed over positions it stays exact,
			// with no second DISTINCT ON at the bucket's start.
			rows[i].OpenBalance = rows[i].CloseBalance - rows[i].Change

			datas = append(datas, &settlementv1.TimeframeMetric{
				At:     rows[i].At,
				Metric: metricToProto(rows[i].SettlementMetricColumns),
			})
		}
	}

	return connect.NewResponse(&settlementv1.AnalyticTimeSearchResponse{
		Datas: datas,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(int64(len(all)), page.GetLimit()),
			TotalItems:  uint64(len(all)),
		},
	}), nil
}

type timeSeriesRow struct {
	At string
	settlement_service_models.SettlementMetricColumns
}

// timeSeries reads one page of buckets in ONE statement: each bucket's movement, and each bucket's
// position as the sum of every position's latest close at or before the bucket's last day.
func (s *Service) timeSeries(
	ctx context.Context,
	grain reportGrain,
	scope string,
	args map[string]any,
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

	args["ats"] = dateArray(ats)
	args["froms"] = dateArray(froms)
	args["tos"] = dateArray(tos)

	direction := "ASC"
	if descending {
		direction = "DESC"
	}

	query := fmt.Sprintf(`
SELECT to_char(b.at, 'YYYY-MM-DD') AS at, %[3]s, COALESCE(c.close_balance, 0) AS close_balance
FROM unnest(CAST(@ats AS date[]), CAST(@froms AS date[]), CAST(@tos AS date[])) AS b(at, bucket_from, bucket_to)
LEFT JOIN LATERAL (
    SELECT %[4]s
    FROM %[1]s r
    WHERE %[2]s AND r.day BETWEEN b.bucket_from AND b.bucket_to
) m ON TRUE
LEFT JOIN LATERAL (
    SELECT SUM(x.close_balance) AS close_balance
    FROM (
        SELECT DISTINCT ON (%[5]s) r.close_balance
        FROM %[1]s r
        WHERE %[2]s AND r.day <= b.bucket_to
        ORDER BY %[5]s, r.day DESC
    ) x
) c ON TRUE
ORDER BY b.at %[6]s`,
		grain.table, scope, movementsFrom("m"), movementSums("r"), columnsOf("r", grain.position), direction)

	rows := []timeSeriesRow{}

	err := s.db.WithContext(ctx).Raw(query, args).Scan(&rows).Error
	if err != nil {
		return nil, dbError(err)
	}

	return rows, nil
}
