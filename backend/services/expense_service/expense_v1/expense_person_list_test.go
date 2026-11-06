package expense_v1_test

import (
	"context"
	"errors"
	"slices"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// WHO THE "CREATED BY" FILTER OFFERS OVER AN EXPENSE METRIC (expense_person_list.go,
// a-who-filter-lists-the-people-on-its-rows), on metricBook's entries:
//
//	team A (seller)      Ani 61 — ads 15 Oct, other 10 Oct, payroll 31 Oct · Budi 62 — rent 1 Oct, ads 14 and 16 Oct,
//	                     cancels the 16 Oct ad on 17 Oct · Dewi 64 — corrects the 14 Oct ad on 20 Oct
//	team B (seller)      68 — payroll 31 Oct
//	Gudang Pusat (11)    root (1) — rent 1 Oct
//
// and, per test, a row nobody is recorded on and Budi's rent on team B.

func personList(
	t *testing.T,
	svc *expense_v1.Service,
	team uint64,
	page, limit uint32,
	metrics ...string,
) *expensev1.ExpensePersonListResponse {
	t.Helper()

	res, err := svc.ExpensePersonList(context.Background(), connect.NewRequest(&expensev1.ExpensePersonListRequest{
		TeamId: team,
		Filter: &expensev1.ExpensePersonListFilter{MetricIds: metrics},
		Page:   &commonv1.CommonPagination{Page: page, Limit: limit},
	}))
	if err != nil {
		t.Fatalf("ExpensePersonList(team %d, %v): %v", team, metrics, err)
	}

	return res.Msg
}

// among is `ids` narrowed to `known`, in order — a root read covers every team's rows, so a row another suite left
// committed in warehouse_test must not fail the order this test pins.
func among(ids []uint64, known ...uint64) []uint64 {
	out := make([]uint64, 0, len(known))

	for _, id := range ids {
		if slices.Contains(known, id) {
			out = append(out, id)
		}
	}

	return out
}

// The people on the team's rows, the latest first, the id breaking a tie — a corrector who only corrected included
// (an-expense-correction-counts-for-who-made-it), "not recorded" (0) never. It pages — counting people, not rows, even
// past the last page — and sorts ascending on request.
func TestExpensePersonList_ThePeopleOnTheTeamsRowsLatestFirst(t *testing.T) {
	f := metricBook(t)

	// The newest row of all, typed with no identity: user 0, never a person.
	_, err := f.svc.ExpenseCreate(context.Background(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId: teamA, Kind: expensev1.ExpenseKind_EXPENSE_KIND_OTHER, Amount: 10_000, OccurredAt: "2026-11-02",
		FinanceAccountId: payingAccount,
	}))
	if err != nil {
		t.Fatalf("an expense with no identity: %v", err)
	}

	res := personList(t, f.svc, teamA, 1, 200)

	if want := []uint64{userAni, userDewi, userBudi}; !slices.Equal(res.GetIds(), want) {
		t.Fatalf("ids = %v, want %v — Ani 31 Oct, Dewi 20 Oct, Budi 17 Oct; nobody for 0", res.GetIds(), want)
	}

	people := res.GetItems()[0].GetPerson().GetMapData()
	if people[userAni].GetLastDay() != "2026-10-31" || people[userDewi].GetLastDay() != "2026-10-20" ||
		people[userBudi].GetLastDay() != "2026-10-17" {
		t.Fatalf("people = %v — each at their newest report day, a correction's on the day it was made", people)
	}

	if res.GetPageInfo().GetTotalItems() != 3 {
		t.Fatalf("page info = %+v, want 3 people", res.GetPageInfo())
	}

	first, second := personList(t, f.svc, teamA, 1, 2), personList(t, f.svc, teamA, 2, 2)
	if !slices.Equal(first.GetIds(), []uint64{userAni, userDewi}) || !slices.Equal(second.GetIds(), []uint64{userBudi}) ||
		first.GetPageInfo().GetTotalPage() != 2 {
		t.Fatalf("pages = %v / %v (info %+v)", first.GetIds(), second.GetIds(), first.GetPageInfo())
	}

	// A page past the end lists nobody and still says how many there are.
	past := personList(t, f.svc, teamA, 3, 2)
	if len(past.GetIds()) != 0 || past.GetPageInfo().GetTotalItems() != 3 || past.GetPageInfo().GetTotalPage() != 2 {
		t.Fatalf("page 3 = %v (info %+v), want nobody of 3 people on 2 pages", past.GetIds(), past.GetPageInfo())
	}

	asc, err := f.svc.ExpensePersonList(context.Background(), connect.NewRequest(&expensev1.ExpensePersonListRequest{
		TeamId: teamA,
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 200},
		Sort: &expensev1.ExpensePersonListFilterSort{
			SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_ASC,
			S:        &expensev1.ExpensePersonListFilterSort_Person{Person: expensev1.ExpensePersonSort_EXPENSE_PERSON_SORT_LAST_DAY},
		},
	}))
	if err != nil {
		t.Fatalf("ExpensePersonList ASC: %v", err)
	}

	if want := []uint64{userBudi, userDewi, userAni}; !slices.Equal(asc.Msg.GetIds(), want) {
		t.Fatalf("ASC ids = %v, want %v", asc.Msg.GetIds(), want)
	}
}

// SCOPED AS THE METRICS ARE (the-expense-metrics-follow-the-decisions-already-made): each team its own people — a seller,
// another seller, a warehouse team — a team with no expense row nobody, and the root team every team's, a person on two
// teams' rows once, at their latest day on either.
func TestExpensePersonList_EachTeamItsOwnRootEveryTeams(t *testing.T) {
	f := metricBook(t)

	// Budi also typed team B's rent — before his latest day on team A.
	expenseAs(t, f.svc, userBudi, teamB, expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL, 100_000, "2026-10-05", 0)

	if got := personList(t, f.svc, teamB, 1, 200).GetIds(); !slices.Equal(got, []uint64{68, userBudi}) {
		t.Fatalf("team B = %v, want 68 (31 Oct) then Budi (5 Oct) — its own rows only", got)
	}

	if got := personList(t, f.svc, warehouseTeam, 1, 200).GetIds(); !slices.Equal(got, []uint64{userRoot}) {
		t.Fatalf("Gudang Pusat = %v, want root, who typed its rent", got)
	}

	// A fourth team, with no expense of its own, sees no one — not team A's, not anybody's.
	const fourth uint64 = 4

	none := personList(t, f.svc, fourth, 1, 200)
	if len(none.GetIds()) != 0 || none.GetPageInfo().GetTotalItems() != 0 || len(none.GetItems()[0].GetPerson().GetMapData()) != 0 {
		t.Fatalf("a fourth team read %v (info %+v), want nobody", none.GetIds(), none.GetPageInfo())
	}

	root := personList(t, f.svc, san_auth.RootTeamID, 1, 200)

	// 68 and Ani tie on 31 Oct — the id DESC breaks it; Budi once, at 17 Oct (team A), not 5 Oct (team B).
	if want := []uint64{68, userAni, userDewi, userBudi, userRoot}; !slices.Equal(among(root.GetIds(), want...), want) {
		t.Fatalf("root = %v, want every team's people in order %v", root.GetIds(), want)
	}

	if day := root.GetItems()[0].GetPerson().GetMapData()[userBudi].GetLastDay(); day != "2026-10-17" {
		t.Fatalf("Budi's root last day = %q, want 2026-10-17, his latest on any team", day)
	}

	if slices.Contains(root.GetIds(), 0) || root.GetPageInfo().GetTotalItems() < 5 {
		t.Fatalf("root = %v (info %+v)", root.GetIds(), root.GetPageInfo())
	}
}

// ADS EXPENSE ALONE OFFERS ITS ADS PEOPLE: whoever typed only payroll or rent is on none of its rows. With Expenses on the
// table — alone or beside it — every typed kind's people.
func TestExpensePersonList_AdsExpenseAloneOffersItsAdsPeople(t *testing.T) {
	f := metricBook(t)

	// Team A by its ADS rows: Dewi's correction 20 Oct, Budi's cancel 17 Oct, Ani's ad 15 Oct.
	if got := personList(t, f.svc, teamA, 1, 200, metricAds).GetIds(); !slices.Equal(got, []uint64{userDewi, userBudi, userAni}) {
		t.Fatalf("team A, Ads expense = %v, want Dewi, Budi, Ani by their ADS days", got)
	}

	for _, metrics := range [][]string{{metricExpenses}, {metricAds, metricExpenses}, nil} {
		if got := personList(t, f.svc, teamA, 1, 200, metrics...).GetIds(); !slices.Equal(got, []uint64{userAni, userDewi, userBudi}) {
			t.Fatalf("team A, %v = %v, want Ani, Dewi, Budi by every typed kind", metrics, got)
		}
	}

	// Team B typed only payroll: Ads expense offers nobody there.
	if got := personList(t, f.svc, teamB, 1, 200, metricAds); len(got.GetIds()) != 0 || got.GetPageInfo().GetTotalItems() != 0 {
		t.Fatalf("team B, Ads expense = %v (info %+v), want nobody", got.GetIds(), got.GetPageInfo())
	}

	root := personList(t, f.svc, san_auth.RootTeamID, 1, 200, metricAds).GetIds()
	if slices.Contains(root, 68) || slices.Contains(root, userRoot) {
		t.Fatalf("root, Ads expense = %v — 68's payroll and root's rent are no ADS row", root)
	}

	_, err := f.svc.ExpensePersonList(context.Background(), connect.NewRequest(&expensev1.ExpensePersonListRequest{
		TeamId: teamA,
		Filter: &expensev1.ExpensePersonListFilter{MetricIds: []string{"metrics/orders/created"}},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 200},
	}))

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeInvalidArgument {
		t.Fatalf("another service's metric: err = %v, want InvalidArgument", err)
	}
}

// whoever-reads-a-list-may-filter-it: exactly MetricData's roles — CS and warehouse staff included.
func TestExpensePersonList_PolicyIsMetricDatas(t *testing.T) {
	got := policyRoles(t, "warehouse.expense.v1.ExpensePersonListRequest")
	want := policyRoles(t, "warehouse.expense.v1.MetricDataRequest")

	if len(got) != len(want) {
		t.Fatalf("roles = %v, want MetricData's %v", got, want)
	}

	for role := range want {
		if !got[role] {
			t.Fatalf("roles = %v, want MetricData's %v — %v is missing", got, want, role)
		}
	}
}
