package settlement_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

const (
	metricSettlement = "metrics/settlement"
	metricTypes      = "metrics/settlement/types"
)

func window(min, max string) *analytic_basev1.FilterItem {
	return &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_DateRangeFilter{
		DateRangeFilter: &analytic_basev1.DateRangeFilter{DateMin: min, DateMax: max},
	}}
}

func shopFilter(id uint64) *analytic_basev1.FilterItem {
	return &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_ShopFilter{
		ShopFilter: &analytic_basev1.ShopFilter{ShopId: id},
	}}
}

func userFilter(id uint64) *analytic_basev1.FilterItem {
	return &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_UserFilter{
		UserFilter: &analytic_basev1.UserFilter{UserId: id},
	}}
}

func idKeys(ids ...uint64) *analytic_basev1.MetricKeys {
	return &analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Ids{Ids: &analytic_basev1.IDList{Ids: ids}}}
}

func dayKeys(days ...string) *analytic_basev1.MetricKeys {
	return &analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: days}}}
}

func metricData(
	svc *settlement_v1.Service,
	teamID uint64,
	group analytic_basev1.GroupType,
	keys *analytic_basev1.MetricKeys,
	filters []*analytic_basev1.FilterItem,
	metricIDs ...string,
) ([]*settlementv1.MetricData, error) {
	res, err := svc.MetricData(context.Background(), connect.NewRequest(&settlementv1.MetricDataRequest{
		TeamId:    teamID,
		GroupBy:   group,
		Filters:   filters,
		Keys:      keys,
		MetricIds: metricIDs,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetMetricDatas(), nil
}

func mustData(
	t *testing.T,
	svc *settlement_v1.Service,
	group analytic_basev1.GroupType,
	keys *analytic_basev1.MetricKeys,
	filters []*analytic_basev1.FilterItem,
	metricIDs ...string,
) []*settlementv1.MetricData {
	t.Helper()

	datas, err := metricData(svc, team, group, keys, filters, metricIDs...)
	if err != nil {
		t.Fatalf("MetricData: %v", err)
	}

	return datas
}

// THE HEADLINE over the worked example: what buyers paid (120.000), what reached us (the 100.000 fund less the
// 10.000 fee), the 30.000 that never did — a quarter of the sale — and the position the account ends on.
//
// ⚠ AND THE BREAKDOWN EXPLAINS IT: Settlement by type's fields add up to `received`, by construction.
func TestMetricData_SummaryIsTheHeadlineAndTheBreakdownExplainsIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	fold(t, svc, workedExample()...)

	datas := mustData(t, svc, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil,
		[]*analytic_basev1.FilterItem{window("2026-01-01", "2026-01-04")}, metricSettlement, metricTypes)

	if len(datas) != 2 {
		t.Fatalf("%d answers, want one per asked metric", len(datas))
	}

	headline := datas[0].GetSettlementSummary()
	if headline.GetSales() != sale || headline.GetReceived() != 90_000 || headline.GetWithdrawn() != 0 ||
		headline.GetGap() != 30_000 || headline.GetPositionToDate() != 30_000 {
		t.Fatalf("headline = %+v", headline)
	}

	if headline.TakeRate == nil || headline.GetTakeRate() != 0.25 {
		t.Fatalf("take rate = %v, want 0.25 — the gap over the sale", headline.TakeRate)
	}

	types := datas[1].GetTypesSummary()
	if types.GetFund() != 100_000 || types.GetExternalAdsFee() != -10_000 {
		t.Fatalf("types = %+v", types)
	}

	sum := types.GetFund() + types.GetExternalAdsFee() + types.GetAffiliateFee() + types.GetMarketplaceAdjustment() +
		types.GetShipmentAdjustment() + types.GetLogisticReimbursement() + types.GetPlatformReimbursement() +
		types.GetMarketplaceProgram() + types.GetOther() + types.GetSystemAdjustment()
	if sum != headline.GetReceived() {
		t.Fatalf("the types add up to %d, received is %d — the breakdown must explain the headline", sum, headline.GetReceived())
	}
}

// A withdrawal is not received — it is our own money moving on — but it IS in the position.
func TestMetricData_AWithdrawalMovesThePositionNotReceived(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	fold(t, svc, workedExample()...)
	fold(t, svc, logPosted(30, "2026-01-04", shop, 0, 0, 3,
		settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL, -60_000))

	headline := mustData(t, svc, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil,
		[]*analytic_basev1.FilterItem{window("2026-01-01", "2026-01-04")}, metricSettlement)[0].GetSettlementSummary()

	if headline.GetWithdrawn() != 60_000 || headline.GetReceived() != 90_000 || headline.GetPositionToDate() != 90_000 {
		t.Fatalf("headline = %+v — withdrawn 60.000, received unchanged, the position 30.000 + 60.000", headline)
	}
}

// Every asked day is a row — 01-04 had no movement and still carries the position forward. A day with no sale has no
// take rate: it is UNSET, never 0.
func TestMetricData_DailyCarriesTheQuietDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	fold(t, svc, workedExample()...)

	items := mustData(t, svc, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		dayKeys("2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"),
		[]*analytic_basev1.FilterItem{window("2026-01-01", "2026-01-04")}, metricSettlement)[0].GetSettlementByDay().GetItems()

	want := map[string]struct{ sales, received, position int64 }{
		"2026-01-01": {sale, 0, 120_000},
		"2026-01-02": {0, -10_000, 130_000},
		"2026-01-03": {0, 100_000, 30_000},
		"2026-01-04": {0, 0, 30_000},
	}

	for day, w := range want {
		got := items[day]
		if got.GetSales() != w.sales || got.GetReceived() != w.received || got.GetPositionToDate() != w.position {
			t.Fatalf("%s = %+v, want %+v", day, got, w)
		}
	}

	if items["2026-01-01"].TakeRate == nil || items["2026-01-02"].TakeRate != nil {
		t.Fatalf("take rate set on the sale's day only: 01-01 %v, 01-02 %v",
			items["2026-01-01"].TakeRate, items["2026-01-02"].TakeRate)
	}
}

// A month is the window's part of it: the movement over its days IN THE WINDOW, the position at the window's end. A
// period the window does not meet is zero.
func TestMetricData_APeriodIsClippedToTheWindow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	fold(t, svc, workedExample()...)

	items := mustData(t, svc, analytic_basev1.GroupType_GROUP_TYPE_MONTHLY, dayKeys("2026-01-01", "2026-02-01"),
		[]*analytic_basev1.FilterItem{window("2026-01-02", "2026-01-03")}, metricSettlement)[0].GetSettlementByDay().GetItems()

	if m := items["2026-01-01"]; m.GetSales() != 0 || m.GetReceived() != 90_000 || m.GetPositionToDate() != 30_000 {
		t.Fatalf("January in the window = %+v — the sale of 01-01 is outside it", m)
	}

	if m, ok := items["2026-02-01"]; !ok || m.GetPositionToDate() != 0 || m.GetReceived() != 0 {
		t.Fatalf("February, outside the window, must come back zero — got %+v", m)
	}
}

// A period is keyed by its FIRST day — any other day names no row.
func TestMetricData_RefusesADayThatStartsNoPeriod(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	_, err := metricData(svc, team, analytic_basev1.GroupType_GROUP_TYPE_WEEKLY, dayKeys("2026-01-01"),
		[]*analytic_basev1.FilterItem{window("2026-01-01", "2026-01-31")}, metricSettlement)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a Thursday as a week's key: got %v, want InvalidArgument — 2026-01-01 is not a Monday", err)
	}
}

// Every asked shop comes back — one with no row up to the window's end all zero — and a shop's position is the one it
// ends the window on, its movement only the window's.
func TestMetricData_ByShopFillsEveryAskedKey(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	fold(t, svc, workedExample()...)
	fold(t, svc, logPosted(20, "2026-01-02", otherShop, otherOrder, 8, 8,
		settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL, -50_000))

	items := mustData(t, svc, analytic_basev1.GroupType_GROUP_TYPE_SHOP, idKeys(shop, otherShop, 999),
		[]*analytic_basev1.FilterItem{window("2026-01-02", "2026-01-03")}, metricSettlement)[0].GetSettlementById().GetItems()

	if m := items[shop]; m.GetSales() != 0 || m.GetReceived() != 90_000 || m.GetPositionToDate() != 30_000 {
		t.Fatalf("shop %d = %+v", shop, m)
	}

	if m := items[otherShop]; m.GetSales() != 50_000 || m.GetPositionToDate() != 50_000 || m.GetTakeRate() != 1 {
		t.Fatalf("shop %d = %+v", otherShop, m)
	}

	if m, ok := items[999]; !ok || m.GetPositionToDate() != 0 {
		t.Fatalf("an asked shop with nothing must still come back, zero")
	}
}

// The person table answers a person: every row of an order counts for its creator — the fund and the fee were posted
// by someone else.
func TestMetricData_ByUserReadsThePersonTable(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	fold(t, svc, workedExample()...)

	items := mustData(t, svc, analytic_basev1.GroupType_GROUP_TYPE_USER, idKeys(creator, 3),
		[]*analytic_basev1.FilterItem{window("2026-01-01", "2026-01-04")}, metricSettlement)[0].GetSettlementById().GetItems()

	if m := items[creator]; m.GetSales() != sale || m.GetPositionToDate() != 30_000 {
		t.Fatalf("creator = %+v", m)
	}

	if m := items[3]; m.GetReceived() != 0 || m.GetPositionToDate() != 0 {
		t.Fatalf("the poster of the fund = %+v — the fund counts for the order's creator", m)
	}
}

// ⚠ A SHOP AND A PERSON TOGETHER is refused — whichever of the two is the group and whichever the filter: no table holds
// that combination (one-settlement-metric-reads-both-tables).
func TestMetricData_RefusesAShopAndAPersonTogether(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	cases := map[string]struct {
		group   analytic_basev1.GroupType
		keys    *analytic_basev1.MetricKeys
		filters []*analytic_basev1.FilterItem
	}{
		"by shop, for a person": {analytic_basev1.GroupType_GROUP_TYPE_SHOP, idKeys(shop),
			[]*analytic_basev1.FilterItem{window("2026-01-01", "2026-01-04"), userFilter(creator)}},
		"by person, for a shop": {analytic_basev1.GroupType_GROUP_TYPE_USER, idKeys(creator),
			[]*analytic_basev1.FilterItem{window("2026-01-01", "2026-01-04"), shopFilter(shop)}},
		"a headline for both": {analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil,
			[]*analytic_basev1.FilterItem{window("2026-01-01", "2026-01-04"), shopFilter(shop), userFilter(creator)}},
	}

	for name, c := range cases {
		_, err := metricData(svc, team, c.group, c.keys, c.filters, metricSettlement)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("%s: got %v, want InvalidArgument", name, err)
		}
	}
}

// A team reads its own figures and nothing of another team's; the root team reads every team's.
func TestMetricData_TheScopeIsTheCallersTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	fold(t, svc, workedExample()...)

	filters := []*analytic_basev1.FilterItem{window("2026-01-01", "2026-01-04")}

	other, err := metricData(svc, team+1, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, filters, metricSettlement)
	if err != nil {
		t.Fatalf("another team's headline: %v", err)
	}

	if other[0].GetSettlementSummary().GetSales() != 0 {
		t.Fatalf("another team read this team's sale")
	}

	root, err := metricData(svc, san_auth.RootTeamID, analytic_basev1.GroupType_GROUP_TYPE_TEAM, idKeys(team), filters,
		metricSettlement)
	if err != nil {
		t.Fatalf("the root team by team: %v", err)
	}

	if m := root[0].GetSettlementById().GetItems()[team]; m.GetSales() != sale || m.GetPositionToDate() != 30_000 {
		t.Fatalf("the root team's read of team %d = %+v", team, m)
	}
}
