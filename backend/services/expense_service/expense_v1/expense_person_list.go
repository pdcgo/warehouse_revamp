package expense_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
)

// ExpensePersonList implements [expensev1connect.ExpenseAnalyticServiceHandler].
//
// The people a USER filter over an expense metric offers (a-who-filter-lists-the-people-on-its-rows): everyone
// `expense_metric_daily_reports` holds a row for in the reader's scope, the latest first — whoever typed an expense and
// whoever corrected or cancelled one, each on the rows the USER group and filter read
// (an-expense-correction-counts-for-who-made-it). So the picker can never offer a person whose figures the metric cannot
// show — and never the team's member list. With Ads expense alone on the table only its ADS rows are read: a person who
// typed only payroll is on none of them.
//
// THE SCOPE IS THE METRICS' (metricReaderOf): a team its own rows, the root team every team's — a person once, at their
// latest day on any of them. A person who has left the team, or whose account is suspended, is still here: they are on
// the rows (a-filter-keeps-former-and-suspended-people). 0 is "not recorded", never a person.
//
// Not bounded by the composer's date range, as SettlementPersonList and OrderCreatorList are not: the picker loads the
// set once and filters as you type.
func (s *Service) ExpensePersonList(
	ctx context.Context,
	req *connect.Request[expensev1.ExpensePersonListRequest],
) (*connect.Response[expensev1.ExpensePersonListResponse], error) {
	page := req.Msg.GetPage()
	reader := metricReaderOf(req.Msg.GetTeamId())

	var metrics []expenseMetric

	for _, id := range req.Msg.GetFilter().GetMetricIds() {
		metric, err := metricOf(id)
		if err != nil {
			return nil, err
		}

		metrics = append(metrics, metric)
	}

	// Ads expense alone reads the ADS rows only; no metric named, or Expenses among them, every typed kind's.
	adsOnly := len(metrics) > 0 && allAds(metrics)

	// A fresh query per statement: the page and a fallback count must not share one GORM statement.
	scope := func() *gorm.DB {
		query := s.db.
			WithContext(ctx).
			Table("expense_metric_daily_reports AS r").
			Where("r.user_id <> 0")

		if !reader.all {
			query = query.Where("r.team_id = ?", reader.teamID)
		}

		if adsOnly {
			query = query.Where("r.kind = ?", int32(expensev1.ExpenseKind_EXPENSE_KIND_ADS))
		}

		return query
	}

	order := "DESC"
	if req.Msg.GetSort().GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_ASC {
		order = "ASC"
	}

	var rows []struct {
		UserID  uint64
		LastDay time.Time
		Total   int64
	}

	// ONE PASS over the scope's rows: a person holds a row per day, kind and shop, so the window counts the GROUPS — the
	// people, not the rows — beside the page, and the report is read once rather than once more for a COUNT.
	err := scope().
		Select("r.user_id, MAX(r.day) AS last_day, COUNT(*) OVER () AS total").
		Group("r.user_id").
		// user_id breaks a tie, so a page boundary never splits two people last counted on the same day.
		Order("last_day " + order + ", r.user_id " + order).
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Scan(&rows).
		Error
	if err != nil {
		return nil, metricDBError(err)
	}

	var total int64
	if len(rows) > 0 {
		total = rows[0].Total
	}

	// A page past the end carries no row to read the count from: then, and only then, it is counted on its own.
	if len(rows) == 0 && pageOffset(page) > 0 {
		err = scope().
			Select("COUNT(DISTINCT r.user_id)").
			Scan(&total).
			Error
		if err != nil {
			return nil, metricDBError(err)
		}
	}

	people := make(map[uint64]*expensev1.ExpensePersonItem, len(rows))
	ids := make([]uint64, 0, len(rows))

	for _, row := range rows {
		people[row.UserID] = &expensev1.ExpensePersonItem{UserId: row.UserID, LastDay: row.LastDay.Format(dateLayout)}
		ids = append(ids, row.UserID)
	}

	return connect.NewResponse(&expensev1.ExpensePersonListResponse{
		// PERSON is the only slice there is, so it is sent whatever data_request says.
		Items: []*expensev1.ExpensePersonListResponseItem{{
			D: &expensev1.ExpensePersonListResponseItem_Person{Person: &expensev1.ExpensePersonMapItem{MapData: people}},
		}},
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}
