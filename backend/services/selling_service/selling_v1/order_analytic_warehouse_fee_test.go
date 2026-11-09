package selling_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// WAREHOUSE FEE (the-warehouse-fee-prototype-is-accepted): the fee frozen on each order, folded from the same
// OrderPlaced / OrderCancelled the order metrics fold — net, each on its own day
// (a-warehouse-fee-counts-on-its-day-and-a-cancel-takes-it-back-on-its-day), grouped like the order metrics
// (warehouse-fee-groups-like-the-order-metrics), and its amount read by the warehouse too
// (a-warehouse-sees-its-own-fee-amount).
//
// Every order here is pricedOrder's: goods 14.000 at 2.5% — a fee of 350.

const (
	metricWarehouseFee = "metrics/warehouse_fee"
	orderFee           = 350.0
)

// 10:00 WIB on the 29th, 30th and 31st of October.
var (
	day29 = foldAt
	day31 = time.Date(2026, 10, 31, 3, 0, 0, 0, time.UTC)
)

func daysKeys(days ...string) *analytic_basev1.MetricKeys {
	return &analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: days}}}
}

func idKeys(ids ...uint64) *analytic_basev1.MetricKeys {
	return &analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Ids{Ids: &analytic_basev1.IDList{Ids: ids}}}
}

// feeSummary is the headline of Warehouse Fee as `teamID` reads it.
func feeSummary(t *testing.T, analytic *selling_v1.Analytic, teamID uint64) *sellingv1.WarehouseFeeMetric {
	t.Helper()

	datas, err := metricData(analytic, teamID, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, metricWarehouseFee)
	if err != nil {
		t.Fatalf("MetricData(%d): %v", teamID, err)
	}

	return datas[0].GetWarehouseFeeSummary()
}

func wantFee(t *testing.T, what string, got *sellingv1.WarehouseFeeMetric, count int64, amount float64) {
	t.Helper()

	if got == nil || got.GetTransactionCount() != count || got.GetAmount() != amount {
		t.Fatalf("%s = %+v, want %d transactions, amount %v", what, got, count, amount)
	}
}

// A CANCEL TAKES THE FEE BACK ON ITS OWN DAY: placed on the 29th (+1, +350 there), cancelled on the 31st (−1, −350
// there). The 29th is never re-folded, the 30th stays quiet, and the month nets to zero. Orders created still counts
// the order on the 29th — the fee row is beside it, not instead of it.
func TestWarehouseFeeFold_ACancelTakesItBackOnItsOwnDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithFees(t, db, knownCosts(), &fakeFees{percent: 2.5})
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{})
	orderID := pricedOrder(t, svc, insertShop(t, db, 2, "Shop", "S1", "shopee"))

	foldEvent(t, analytic, placedEvent(orderID, day29))
	foldEvent(t, analytic, placedEvent(orderID, day29)) // the redelivery counts nothing

	wantFee(t, "after the placement", feeSummary(t, analytic, 2), 1, orderFee)

	foldEvent(t, analytic, cancelledEvent(orderID, day31))
	foldEvent(t, analytic, cancelledEvent(orderID, day31)) // the redelivery takes nothing more back

	datas, err := metricData(analytic, 2, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		daysKeys("2026-10-29", "2026-10-30", "2026-10-31"), metricWarehouseFee, metricCreated)
	if err != nil {
		t.Fatalf("MetricData by day: %v", err)
	}

	byDay := datas[0].GetWarehouseFeeByDay().GetItems()
	wantFee(t, "the 29th", byDay["2026-10-29"], 1, orderFee)
	wantFee(t, "the 30th", byDay["2026-10-30"], 0, 0)
	wantFee(t, "the 31st", byDay["2026-10-31"], -1, -orderFee)

	if created := datas[1].GetCreatedByDay().GetItems(); created["2026-10-29"].GetCreatedCount() != 1 {
		t.Fatalf("Orders created by day = %+v, want the order on the 29th, untouched by the fee", created)
	}

	wantFee(t, "the month's headline", feeSummary(t, analytic, 2), 0, 0)

	months, err := metricData(analytic, 2, analytic_basev1.GroupType_GROUP_TYPE_MONTHLY, daysKeys("2026-10-01"),
		metricWarehouseFee)
	if err != nil {
		t.Fatalf("MetricData by month: %v", err)
	}

	wantFee(t, "October", months[0].GetWarehouseFeeByDay().GetItems()["2026-10-01"], 0, 0)

	// The 29th alone still reads the fee — a later cancel never re-folds an earlier day.
	resp, err := analytic.MetricData(context.Background(), connect.NewRequest(&sellingv1.MetricDataRequest{
		TeamId: 2, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, MetricIds: []string{metricWarehouseFee},
		Filters: []*analytic_basev1.FilterItem{{F: &analytic_basev1.FilterItem_DateRangeFilter{
			DateRangeFilter: &analytic_basev1.DateRangeFilter{DateMin: "2026-10-29", DateMax: "2026-10-30"},
		}}},
	}))
	if err != nil {
		t.Fatalf("MetricData for the 29th–30th: %v", err)
	}

	wantFee(t, "the 29th–30th", resp.Msg.GetMetricDatas()[0].GetWarehouseFeeSummary(), 1, orderFee)
}

// EVERY GROUP SUMS THE SAME ROWS: three orders — two in shop A by person 7, one in shop B by person 8 — and one of
// shop A's cancelled the same day. Shop, seller, warehouse, creator and every period each add up to the net two fees,
// and the search ranks by amount.
func TestWarehouseFeeMetric_EveryGroupSumsTheNetFees(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithFees(t, db, knownCosts(), &fakeFees{percent: 2.5})
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{testWarehouse: true})

	shopA := insertShop(t, db, 2, "Shop A", "SA", "shopee")
	shopB := insertShop(t, db, 2, "Shop B", "SB", "shopee")

	first := pricedOrder(t, svc, shopA)
	second := pricedOrder(t, svc, shopA)

	byEight, err := svc.OrderCreate(asUser(8), connect.NewRequest(feeOrderReq(shopB)))
	if err != nil {
		t.Fatalf("create by person 8: %v", err)
	}

	for _, id := range []uint64{first, second, byEight.Msg.GetOrder().GetId()} {
		foldEvent(t, analytic, placedEvent(id, day29))
	}

	foldEvent(t, analytic, cancelledEvent(second, day29))

	byID := func(group analytic_basev1.GroupType, ids ...uint64) map[uint64]*sellingv1.WarehouseFeeMetric {
		t.Helper()

		datas, err := metricData(analytic, 2, group, idKeys(ids...), metricWarehouseFee)
		if err != nil {
			t.Fatalf("MetricData by %s: %v", group, err)
		}

		return datas[0].GetWarehouseFeeById().GetItems()
	}

	shops := byID(analytic_basev1.GroupType_GROUP_TYPE_SHOP, shopA, shopB)
	wantFee(t, "shop A (two placed, one cancelled)", shops[shopA], 1, orderFee)
	wantFee(t, "shop B", shops[shopB], 1, orderFee)

	wantFee(t, "the seller", byID(analytic_basev1.GroupType_GROUP_TYPE_TEAM, 2)[2], 2, 2*orderFee)
	wantFee(t, "the warehouse", byID(analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE, testWarehouse)[testWarehouse],
		2, 2*orderFee)

	users := byID(analytic_basev1.GroupType_GROUP_TYPE_USER, 7, 8)
	wantFee(t, "person 7", users[7], 1, orderFee)
	wantFee(t, "person 8", users[8], 1, orderFee)

	for group, key := range map[analytic_basev1.GroupType]string{
		analytic_basev1.GroupType_GROUP_TYPE_DAILY:   "2026-10-29",
		analytic_basev1.GroupType_GROUP_TYPE_WEEKLY:  "2026-10-26", // the Monday
		analytic_basev1.GroupType_GROUP_TYPE_MONTHLY: "2026-10-01",
		analytic_basev1.GroupType_GROUP_TYPE_YEARLY:  "2026-01-01",
	} {
		datas, err := metricData(analytic, 2, group, daysKeys(key), metricWarehouseFee)
		if err != nil {
			t.Fatalf("MetricData by %s: %v", group, err)
		}

		wantFee(t, group.String(), datas[0].GetWarehouseFeeByDay().GetItems()[key], 2, 2*orderFee)
	}

	wantFee(t, "the headline", feeSummary(t, analytic, 2), 2, 2*orderFee)

	// Filters narrow the figures like the order metrics': shop A's creator 7 only.
	resp, err := analytic.MetricData(context.Background(), connect.NewRequest(&sellingv1.MetricDataRequest{
		TeamId: 2, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, MetricIds: []string{metricWarehouseFee},
		Filters: append(october(),
			&analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_ShopFilter{
				ShopFilter: &analytic_basev1.ShopFilter{ShopId: shopB},
			}},
			&analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_UserFilter{
				UserFilter: &analytic_basev1.UserFilter{UserId: 8},
			}},
		),
	}))
	if err != nil {
		t.Fatalf("MetricData filtered: %v", err)
	}

	wantFee(t, "shop B by person 8", resp.Msg.GetMetricDatas()[0].GetWarehouseFeeSummary(), 1, orderFee)

	ranked, err := metricSearch(analytic, 2, analytic_basev1.GroupType_GROUP_TYPE_USER, metricWarehouseFee, "amount")
	if err != nil || len(ranked.GetKeys().GetIds().GetIds()) != 2 {
		t.Fatalf("ranked by amount = %+v (err %v), want both creators", ranked, err)
	}
}

// A WAREHOUSE READS ITS OWN FEE AMOUNT, and may rank by it — unlike an order metric's money, which stays unset for it in
// the same answer. Root and the seller read it too; a FOURTH team (another seller) and another warehouse read nothing.
func TestWarehouseFeeMetric_TheWarehouseSeesTheAmountAFourthTeamNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithFees(t, db, knownCosts(), &fakeFees{percent: 2.5})

	const otherWarehouse uint64 = 901

	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{testWarehouse: true, otherWarehouse: true})
	orderID := pricedOrder(t, svc, insertShop(t, db, 2, "Shop", "S1", "shopee"))

	foldEvent(t, analytic, placedEvent(orderID, day29))

	datas, err := metricData(analytic, testWarehouse, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil,
		metricWarehouseFee, metricCreated)
	if err != nil {
		t.Fatalf("MetricData as the warehouse: %v", err)
	}

	wantFee(t, "the warehouse's fee", datas[0].GetWarehouseFeeSummary(), 1, orderFee)

	if created := datas[1].GetCreatedSummary(); created.GetCreatedCount() != 1 || created.CreatedTotal != nil {
		t.Fatalf("the warehouse's Orders created = %+v, want the count and NO seller money", created)
	}

	ranked, err := metricSearch(analytic, testWarehouse, analytic_basev1.GroupType_GROUP_TYPE_TEAM,
		metricWarehouseFee, "amount")
	if err != nil {
		t.Fatalf("the warehouse ranking by amount: %v", err)
	}

	if ids := ranked.GetKeys().GetIds().GetIds(); len(ids) != 1 || ids[0] != 2 {
		t.Fatalf("the warehouse ranked %v, want its one seller, team 2", ids)
	}

	byID, err := metricData(analytic, testWarehouse, analytic_basev1.GroupType_GROUP_TYPE_TEAM, idKeys(2),
		metricWarehouseFee)
	if err != nil {
		t.Fatalf("MetricData by seller as the warehouse: %v", err)
	}

	wantFee(t, "the warehouse's row for team 2", byID[0].GetWarehouseFeeById().GetItems()[2], 1, orderFee)

	wantFee(t, "root", feeSummary(t, analytic, san_auth.RootTeamID), 1, orderFee)
	wantFee(t, "the seller", feeSummary(t, analytic, 2), 1, orderFee)
	wantFee(t, "a fourth team", feeSummary(t, analytic, 3), 0, 0)
	wantFee(t, "another warehouse", feeSummary(t, analytic, otherWarehouse), 0, 0)

	none, err := metricSearch(analytic, 3, analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE, metricWarehouseFee, "amount")
	if err != nil || len(none.GetKeys().GetIds().GetIds()) != 0 {
		t.Fatalf("a fourth team's search = %+v (err %v), want no keys", none, err)
	}
}

// AN ORDER WITH NO FEE IS NO FEE TRANSACTION: a server built without a pricer freezes none, so neither its placement
// nor its cancel writes a fee row.
func TestWarehouseFeeFold_AnOrderWithNoFeeIsNotATransaction(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{})
	orderID := placeOrder(t, svc, 2, insertShop(t, db, 2, "Shop", "S1", "shopee"))

	foldEvent(t, analytic, placedEvent(orderID, day29))
	foldEvent(t, analytic, cancelledEvent(orderID, day31))

	var rows int64

	err := db.Raw(`SELECT count(*) FROM order_daily_reports WHERE metric = 'warehouse_fee'`).Scan(&rows).Error
	if err != nil || rows != 0 {
		t.Fatalf("%d fee rows (err %v), want none for an order with no fee", rows, err)
	}

	wantFee(t, "the headline", feeSummary(t, analytic, 2), 0, 0)
}
