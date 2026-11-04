package settlement_v1_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// personDay seeds one person-day as the fold leaves it: the daily row, and the person's state row raised to it.
func personDay(t *testing.T, db *gorm.DB, teamID, userID uint64, day string) {
	t.Helper()

	on, err := time.Parse(time.DateOnly, day)
	if err != nil {
		t.Fatal(err)
	}

	err = db.Create(&settlement_service_models.UserSettlementDailyReport{
		Day: on, UserID: userID, TeamID: teamID, LastUpdated: on,
	}).Error
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	err = db.Exec(`
INSERT INTO user_settlement_reports AS s (user_id, team_id, close_balance, last_day, last_updated)
VALUES (?, ?, 0, CAST(? AS date), NOW())
ON CONFLICT (user_id, team_id) DO UPDATE SET last_day = GREATEST(s.last_day, EXCLUDED.last_day)`,
		userID, teamID, day).Error
	if err != nil {
		t.Fatalf("seed the state: %v", err)
	}
}

// the-person-list-reads-the-last-day-from-the-user-report: the order is the person report's last_day — the daily rows
// are not read — and a scope a replay has cut to nothing (NULL) is not offered.
func TestSettlementPersonList_OrdersByTheUserReportsLastDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	for _, row := range []struct {
		user uint64
		day  any
	}{{21, "2026-02-01"}, {22, "2026-06-30"}, {23, "2026-04-15"}, {24, nil}} {
		err := db.Exec(`INSERT INTO user_settlement_reports (user_id, team_id, close_balance, last_day, last_updated)
VALUES (?, ?, 0, CAST(? AS date), NOW())`, row.user, team, row.day).Error
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	// A daily row NEWER than every state row: were the list still reading the daily table, 21 would lead.
	on, _ := time.Parse(time.DateOnly, "2026-12-31")

	err := db.Create(&settlement_service_models.UserSettlementDailyReport{Day: on, UserID: 21, TeamID: team, LastUpdated: on}).Error
	if err != nil {
		t.Fatalf("seed a daily row: %v", err)
	}

	res := personList(t, svc, team, 1, 200)

	if want := []uint64{22, 23, 21}; !slices.Equal(res.GetIds(), want) {
		t.Fatalf("ids = %v, want %v — by user_settlement_reports.last_day, the NULL one left out", res.GetIds(), want)
	}

	if day := res.GetItems()[0].GetPerson().GetMapData()[21].GetLastDay(); day != "2026-02-01" {
		t.Fatalf("21's last day = %q, want the report's 2026-02-01", day)
	}

	if res.GetPageInfo().GetTotalItems() != 3 {
		t.Fatalf("page info = %+v, want 3 people", res.GetPageInfo())
	}

	asc, err := svc.SettlementPersonList(context.Background(), connect.NewRequest(&settlementv1.SettlementPersonListRequest{
		TeamId: team,
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 200},
		Sort: &settlementv1.SettlementPersonListFilterSort{
			SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_ASC,
			S: &settlementv1.SettlementPersonListFilterSort_Person{
				Person: settlementv1.SettlementPersonSort_SETTLEMENT_PERSON_SORT_LAST_DAY,
			},
		},
	}))
	if err != nil {
		t.Fatalf("SettlementPersonList ASC: %v", err)
	}

	if want := []uint64{21, 23, 22}; !slices.Equal(asc.Msg.GetIds(), want) {
		t.Fatalf("ASC ids = %v, want %v", asc.Msg.GetIds(), want)
	}
}

func personList(
	t *testing.T,
	svc *settlement_v1.Service,
	teamID uint64,
	page, limit uint32,
) *settlementv1.SettlementPersonListResponse {
	t.Helper()

	res, err := svc.SettlementPersonList(context.Background(), connect.NewRequest(&settlementv1.SettlementPersonListRequest{
		TeamId: teamID,
		Page:   &commonv1.CommonPagination{Page: page, Limit: limit},
	}))
	if err != nil {
		t.Fatalf("SettlementPersonList: %v", err)
	}

	return res.Msg
}

// a-who-filter-lists-the-people-on-its-rows: the people the team's person report counts for, the latest first, the id
// breaking a tie — never "not recorded" (0) and never another team's. A former member is still on the rows, so still
// here (a-filter-keeps-former-and-suspended-people).
func TestSettlementPersonList_ThePeopleOnTheTeamsRowsLatestFirst(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	personDay(t, db, team, 7, "2026-01-02")
	personDay(t, db, team, 7, "2026-03-01")
	personDay(t, db, team, 8, "2026-03-01")
	personDay(t, db, team, 9, "2026-02-10") // left the team since — still on the rows
	personDay(t, db, team, 0, "2026-04-01") // not recorded
	personDay(t, db, team+1, 50, "2026-05-01")

	res := personList(t, svc, team, 1, 200)

	if want := []uint64{8, 7, 9}; !slices.Equal(res.GetIds(), want) {
		t.Fatalf("ids = %v, want %v — latest first, the id DESC breaking a tie", res.GetIds(), want)
	}

	people := res.GetItems()[0].GetPerson().GetMapData()
	if people[7].GetLastDay() != "2026-03-01" || people[9].GetLastDay() != "2026-02-10" {
		t.Fatalf("people = %v", people)
	}

	if res.GetPageInfo().GetTotalItems() != 3 {
		t.Fatalf("page info = %+v", res.GetPageInfo())
	}

	// It pages: two, then the third.
	first, second := personList(t, svc, team, 1, 2), personList(t, svc, team, 2, 2)
	if !slices.Equal(first.GetIds(), []uint64{8, 7}) || !slices.Equal(second.GetIds(), []uint64{9}) ||
		first.GetPageInfo().GetTotalPage() != 2 {
		t.Fatalf("pages = %v / %v", first.GetIds(), second.GetIds())
	}
}

// The root team lists every team's people, as its metrics read every team's.
func TestSettlementPersonList_TheRootTeamListsEveryTeams(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	personDay(t, db, team, 7, "2026-01-02")
	personDay(t, db, team+1, 50, "2026-05-01")
	personDay(t, db, team+1, 7, "2026-03-01") // one person on two teams' rows

	res := personList(t, svc, san_auth.RootTeamID, 1, 200)

	if !slices.Contains(res.GetIds(), 7) || !slices.Contains(res.GetIds(), 50) {
		t.Fatalf("root ids = %v, want both teams' people", res.GetIds())
	}

	if want := []uint64{50, 7}; !slices.Equal(res.GetIds(), want) || res.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("root ids = %v (total %d), want %v — a person once, at their latest day on any team",
			res.GetIds(), res.GetPageInfo().GetTotalItems(), want)
	}

	if day := res.GetItems()[0].GetPerson().GetMapData()[7].GetLastDay(); day != "2026-03-01" {
		t.Fatalf("7's root last day = %q, want 2026-03-01", day)
	}

	if other := personList(t, svc, team+1, 1, 200); !slices.Equal(other.GetIds(), []uint64{50, 7}) {
		t.Fatalf("another team read %v", other.GetIds())
	}
}

// whoever-reads-a-list-may-filter-it: exactly MetricData's roles.
func TestSettlementPersonList_PolicyIsMetricDatas(t *testing.T) {
	rolesOf := func(name protoreflect.FullName) []role_basev1.Role {
		desc, err := protoregistry.GlobalFiles.FindDescriptorByName(name)
		if err != nil {
			t.Fatal(err)
		}

		policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
		if policy == nil {
			t.Fatalf("%s has no policy", name)
		}

		return policy.GetRoles()
	}

	got := rolesOf("warehouse.settlement.v1.SettlementPersonListRequest")
	want := rolesOf("warehouse.settlement.v1.MetricDataRequest")

	if !slices.Equal(got, want) {
		t.Fatalf("roles = %v, want MetricData's %v", got, want)
	}
}
