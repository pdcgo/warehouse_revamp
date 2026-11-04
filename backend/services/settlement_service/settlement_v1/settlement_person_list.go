package settlement_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// SettlementPersonList implements [settlementv1connect.SettlementAnalyticServiceHandler].
//
// The people a USER filter over a settlement metric offers (a-who-filter-lists-the-people-on-its-rows): everyone the
// person report holds a row for in this team, the latest first. It reads the person grain the USER group and filter
// read, so the picker can never offer a person whose figures the metric cannot show — and never the team's member list.
//
// ONE ROW PER (user, team): `user_settlement_reports.last_day` is the newest day the person has a daily row on, kept by
// the fold and a replay (the-person-list-reads-the-last-day-from-the-user-report) — the daily rows are never scanned
// here. NULL is a scope a replay has cut to nothing and not yet rebuilt: on no figure, so not offered.
//
// A person who has left the team, or whose account is suspended, is still here: they are on the rows
// (a-filter-keeps-former-and-suspended-people). 0 is "not recorded", never a person. The root team lists every team's,
// as scopeOf reads.
func (s *Service) SettlementPersonList(
	ctx context.Context,
	req *connect.Request[settlementv1.SettlementPersonListRequest],
) (*connect.Response[settlementv1.SettlementPersonListResponse], error) {
	page := req.Msg.GetPage()

	root := req.Msg.GetTeamId() == san_auth.RootTeamID

	// A fresh query per statement: the count and the page must not share one GORM statement.
	scope := func() *gorm.DB {
		query := s.db.
			WithContext(ctx).
			Model(&settlement_service_models.UserSettlementReport{}).
			Where("user_id <> 0").
			Where("last_day IS NOT NULL")

		if !root {
			query = query.Where("team_id = ?", req.Msg.GetTeamId())
		}

		return query
	}

	// A team holds one row per person, so its count is the rows'. The root team reads every team's, where one person
	// can hold a row in several — a person, not a row, is counted.
	count := "COUNT(*)"
	if root {
		count = "COUNT(DISTINCT user_id)"
	}

	var total int64

	err := scope().
		Select(count).
		Scan(&total).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	order := "DESC"
	if req.Msg.GetSort().GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_ASC {
		order = "ASC"
	}

	var rows []struct {
		UserID  uint64
		LastDay time.Time
	}

	query := scope().
		Select("user_id, last_day")

	if root {
		// A person on several teams' rows is listed once, at their latest day on any of them.
		query = scope().
			Select("user_id, MAX(last_day) AS last_day").
			Group("user_id")
	}

	err = query.
		// user_id breaks a tie, so a page boundary never splits two people last counted on the same day. On a team,
		// user_settlement_reports_team_last_day_idx answers it in order.
		Order("last_day " + order + ", user_id " + order).
		Offset(int((page.GetPage() - 1) * page.GetLimit())).
		Limit(int(page.GetLimit())).
		Scan(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	people := make(map[uint64]*settlementv1.SettlementPersonItem, len(rows))
	ids := make([]uint64, 0, len(rows))

	for _, row := range rows {
		people[row.UserID] = &settlementv1.SettlementPersonItem{UserId: row.UserID, LastDay: row.LastDay.Format(dateLayout)}
		ids = append(ids, row.UserID)
	}

	return connect.NewResponse(&settlementv1.SettlementPersonListResponse{
		// PERSON is the only slice there is, so it is sent whatever data_request says.
		Items: []*settlementv1.SettlementPersonListResponseItem{{
			D: &settlementv1.SettlementPersonListResponseItem_Person{Person: &settlementv1.SettlementPersonMapItem{MapData: people}},
		}},
		Ids: ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
