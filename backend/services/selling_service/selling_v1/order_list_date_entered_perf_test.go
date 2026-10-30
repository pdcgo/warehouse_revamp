//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for the status-date window (the-order-list-filters-by-seven-dates)
// on OrderList and OrderStat: a week's window on the first entry into `completed`.
//
//	go test -tags perfaudit -run 'TestPerf_OrderList_DateEntered' -v ./backend/services/selling_service/selling_v1/
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
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

func TestPerf_OrderList_DateEntered(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	shopIDs := make([]uint64, 0, 10)
	for i := range 10 {
		shopIDs = append(shopIDs, insertShop(t, db, 2, "Toko "+strconv.Itoa(i), "TOKO-"+strconv.Itoa(i), "shopee"))
	}

	// 50 000 orders over five teams, and a year of timeline behind them: each placed on its own day, processed the next,
	// completed two days after — 150 000 rows.
	orders := perfOrderRows(50_000, shopIDs)
	san_perf.SeedRows(t, db, orders)

	start := time.Date(2025, time.November, 1, 9, 0, 0, 0, time.UTC)
	logs := make([]selling_service_models.OrderTimelineLog, 0, 3*len(orders))

	for i, o := range orders {
		placed := start.Add(time.Duration(i%365) * 24 * time.Hour)

		logs = append(logs,
			selling_service_models.OrderTimelineLog{OrderID: o.ID, Status: "pending", From: "selling", CreatedAt: placed},
			selling_service_models.OrderTimelineLog{OrderID: o.ID, Status: "processed", From: "warehouse", CreatedAt: placed.Add(24 * time.Hour)},
			selling_service_models.OrderTimelineLog{OrderID: o.ID, Status: "completed", From: "selling", CreatedAt: placed.Add(72 * time.Hour)},
		)
	}

	san_perf.SeedRows(t, db, logs)

	svc := newService(t, db)
	ctx := t.Context()

	from := time.Date(2026, time.March, 1, 0, 0, 0, 0, time.UTC)
	window := &sellingv1.OrderListFilter{
		DateField:       sellingv1.OrderDateField_ORDER_DATE_FIELD_ENTERED_COMPLETED,
		CreatedFromUnix: from.Unix(),
		CreatedToUnix:   from.Add(7*24*time.Hour - time.Second).Unix(),
	}

	list := func() int {
		res, err := svc.OrderList(ctx, connect.NewRequest(&sellingv1.OrderListRequest{
			TeamId: 2, Filter: window, Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
		}))
		if err != nil {
			t.Fatalf("OrderList: %v", err)
		}

		return int(res.Msg.GetPageInfo().GetTotalItems())
	}

	stat := func() {
		_, err := svc.OrderStat(ctx, connect.NewRequest(&sellingv1.OrderStatRequest{
			TeamId: 2,
			Filter: &sellingv1.OrderStatFilter{
				DateField: window.DateField, CreatedFromUnix: window.CreatedFromUnix, CreatedToUnix: window.CreatedToUnix,
			},
		}))
		if err != nil {
			t.Fatalf("OrderStat: %v", err)
		}
	}

	t.Logf("orders in the window: %d", list()) // warm-up

	measure := func(label string) {
		for name, call := range map[string]func(){"OrderList": func() { list() }, "OrderStat": stat} {
			name = label + " " + name
			walls := make([]time.Duration, 0, 5)

			for range 5 {
				probe.Reset()
				wall, dbTime := probe.Measure(call)
				walls = append(walls, wall)
				t.Logf("%s wall=%v db=%v queries=%d", name, wall, dbTime, probe.Count())
			}

			t.Logf("%s MEDIAN wall %v", name, san_perf.Median(walls))
			probe.Report(t, name+" — completed, one week")

			for _, q := range probe.Queries() {
				if strings.Contains(q.SQL, "order_timeline_logs tl WHERE tl.status") {
					t.Log(san_perf.Explain(t, db, q.SQL))

					break
				}
			}
		}
	}

	measure("as built —")

	// THE PROPOSED INDEX, built inside this test's transaction only (it rolls back): the audit proposes, it never migrates.
	if err := db.Exec("CREATE INDEX tmp_order_timeline_logs_status_created ON order_timeline_logs (status, created_at)").Error; err != nil {
		t.Fatalf("index: %v", err)
	}
	if err := db.Exec("ANALYZE order_timeline_logs").Error; err != nil {
		t.Fatalf("analyze: %v", err)
	}

	list()
	measure("with (status, created_at) —")
}
