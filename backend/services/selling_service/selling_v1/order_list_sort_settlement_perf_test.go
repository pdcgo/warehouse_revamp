//go:build perfaudit

package selling_v1_test

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// OrderList's two money sorts (the-total-sort-is-ours-and-the-platform-total-sorts-apart) and its settlement_not_opened
// filter (a-missing-account-is-found-by-its-opened-at), over 50 000 orders (five teams, three warehouses, 11 statuses):
// every order has its own total_cost and platform_total, and 1 in 100 has no settlement_opened_at — the failures a
// person is about to fix. The filter is measured with the partial index orders_settlement_not_opened_idx and, inside
// the same transaction, without it.
func TestPerf_OrderList_SortsAndSettlementNotOpened(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	shopIDs := make([]uint64, 0, 10)
	for i := range 10 {
		shopIDs = append(shopIDs, insertShop(t, db, 2, "Toko "+strconv.Itoa(i), "TOKO-"+strconv.Itoa(i), "shopee"))
	}

	opened := time.Now().Add(-time.Hour)
	orders := perfOrderRows(50_000, shopIDs)

	for i := range orders {
		// Distinct figures, and the two in a different order from each other and from the id.
		orders[i].TotalCost = float64((i*7919)%50_000) + 0.5
		orders[i].PlatformTotal = float64((i * 104_729) % 50_000)

		if i%100 != 0 {
			orders[i].SettlementOpenedAt = &opened
		}
	}

	san_perf.SeedRows(t, db, orders)

	err := db.Exec("ANALYZE orders").Error
	if err != nil {
		t.Fatal(err)
	}

	svc := newService(t, db)
	ctx := t.Context()

	sortBy := func(by sellingv1.OrderRowSort) *sellingv1.OrderListFilterSort {
		return &sellingv1.OrderListFilterSort{
			SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_DESC,
			S:        &sellingv1.OrderListFilterSort_Order{Order: by},
		}
	}

	total := sortBy(sellingv1.OrderRowSort_ORDER_ROW_SORT_TOTAL)
	platform := sortBy(sellingv1.OrderRowSort_ORDER_ROW_SORT_PLATFORM_TOTAL)
	notOpened := &sellingv1.OrderListFilter{SettlementNotOpened: true}

	type listCase struct {
		name   string
		team   uint64
		filter *sellingv1.OrderListFilter
		sort   *sellingv1.OrderListFilterSort
	}

	sorts := []listCase{
		{"root · sort Total, 20", san_auth.RootTeamID, nil, total},
		{"root · sort Platform total, 20", san_auth.RootTeamID, nil, platform},
		{"team 2 · sort Total, 20", 2, nil, total},
		{"team 2 · sort Platform total, 20", 2, nil, platform},
		{"warehouse 900 · sort Platform total, 20", 900, nil, platform},
	}

	filters := []listCase{
		{"root · not opened, 20", san_auth.RootTeamID, notOpened, nil},
		{"team 2 · not opened, 20", 2, notOpened, nil},
		{"warehouse 900 · not opened, 20", 900, notOpened, nil},
		{"root · not opened, sort Total, 20", san_auth.RootTeamID, notOpened, total},
	}

	measure := func(label string, c listCase) {
		req := &sellingv1.OrderListRequest{
			TeamId: c.team, Filter: c.filter, Sort: c.sort,
			Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
		}

		res, err := svc.OrderList(ctx, connect.NewRequest(req)) // warm-up
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, _ := probe.Measure(func() { res, err = svc.OrderList(ctx, connect.NewRequest(req)) })
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}

			walls = append(walls, wall)
		}

		t.Logf("%s%s: MEDIAN wall %v · rows=%d total=%d queries=%d", label, c.name, san_perf.Median(walls),
			len(res.Msg.GetIds()), res.Msg.GetPageInfo().GetTotalItems(), probe.Count())

		for _, q := range probe.Queries() {
			if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
				continue
			}

			plan := san_perf.Explain(t, db, q.SQL)
			t.Logf("PLAN %s%s:\n%s", label, c.name, plan)
		}
	}

	for _, c := range sorts {
		measure("", c)
	}

	for _, c := range filters {
		measure("WITH INDEX · ", c)
	}

	// The stat's mirror, which counts the same set for the tabs.
	probe.Reset()

	_, err = svc.OrderStat(ctx, connect.NewRequest(&sellingv1.OrderStatRequest{
		TeamId: san_auth.RootTeamID, Filter: &sellingv1.OrderStatFilter{SettlementNotOpened: true},
	}))
	if err != nil {
		t.Fatal(err)
	}

	for _, q := range probe.Queries() {
		t.Logf("PLAN WITH INDEX · root · OrderStat not opened:\n%s", san_perf.Explain(t, db, q.SQL))
	}

	// WITHOUT the partial index — dropped inside the test's transaction, rolled back with it.
	err = db.Exec("DROP INDEX orders_settlement_not_opened_idx").Error
	if err != nil {
		t.Fatal(err)
	}

	for _, c := range filters {
		measure("NO INDEX · ", c)
	}
}
