//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for `OrderListFilter.statuses` — the warehouse list's Returns tab,
// `return` and `return_completed` together (the-warehouse-list-has-a-returns-tab): a warehouse's OrderList over 50 000
// orders in eleven statuses, beside the one-status tab it sits next to.
//
//	go test -tags perfaudit -run 'TestPerf_OrderList_Statuses' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestPerf_OrderList_Statuses(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	shopIDs := make([]uint64, 0, 10)
	for i := range 10 {
		shopIDs = append(shopIDs, insertShop(t, db, 2, "Toko "+strconv.Itoa(i), "TOKO-"+strconv.Itoa(i), "shopee"))
	}

	san_perf.SeedRows(t, db, perfOrderRows(50_000, shopIDs))

	svc := newService(t, db)
	ctx := t.Context()

	read := func(filter *sellingv1.OrderListFilter) func() {
		return func() {
			_, err := svc.OrderList(ctx, connect.NewRequest(&sellingv1.OrderListRequest{
				TeamId: 900, Filter: filter,
				Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
			}))
			if err != nil {
				t.Fatalf("OrderList: %v", err)
			}
		}
	}

	cases := []struct {
		name string
		call func()
	}{
		{"Returns tab (statuses)", read(&sellingv1.OrderListFilter{Statuses: []sellingv1.OrderStatus{
			sellingv1.OrderStatus_ORDER_STATUS_RETURN,
			sellingv1.OrderStatus_ORDER_STATUS_RETURN_COMPLETED,
		}})},
		{"one status (status)", read(&sellingv1.OrderListFilter{Status: sellingv1.OrderStatus_ORDER_STATUS_RETURN})},
	}

	cases[0].call() // warm-up

	for _, c := range cases {
		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()
			wall, dbTime := probe.Measure(c.call)
			walls = append(walls, wall)
			t.Logf("%s wall=%v db=%v queries=%d", c.name, wall, dbTime, probe.Count())
		}

		t.Logf("%s MEDIAN wall %v", c.name, san_perf.Median(walls))
		probe.Report(t, c.name+" — a warehouse's list")

		for _, q := range probe.Queries() {
			if strings.Contains(q.SQL, "LIMIT") && !strings.Contains(q.SQL, "SAVEPOINT") {
				t.Log(san_perf.Explain(t, db, q.SQL))

				break
			}
		}
	}
}
