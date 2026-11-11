//go:build perfaudit

// Performance audit for OrderCancel after backlog #10 slice 4 (the audit-rpc-performance skill): the cancel checks the
// count first through the in-process StockLockCheck seam (inventory's own tables), moves the status, and publishes
// OrderCancelled{K, warehouse}; inventory's listener releases the take by K. Measured through the REAL adapter and the
// REAL inventory, on one probed database, beside the take perf's shelf: the cancel, then the listener on its event, then
// a redelivery of that event (the no-op).
//
//	go test -tags perfaudit -p 1 -run TestPerf_OrderCancel_CountCheckThenEvent -v ./backend/cmd/app_development/
package main

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	warehouse_v1 "github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_v1"
)

func TestPerf_OrderCancel_CountCheckThenEvent(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	shop := perfTakeShelf(t, db)

	var cancelled []*eventsv1.OrderCancelled

	send := func(_ context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
		if c := event.GetOrderCancelled(); c != nil {
			cancelled = append(cancelled, c)
		}

		return nil
	}

	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil)
	svc := selling_v1.NewService(db, NewStockPicker(inventory), send, nil, nil, runsEveryShop{}, nil,
		NewWarehouseFeePricer(warehouse_v1.NewService(db, nil)), nil, nil, nil)

	// Six placed orders — one per run, the warm-up included.
	orders := make([]uint64, 0, 6)

	for run := range 6 {
		res, err := svc.OrderCreate(context.Background(), connect.NewRequest(perfTakeReq(shop, perfTakeWarehouse,
			"perf-cancel-"+strconv.Itoa(run))))
		if err != nil {
			t.Fatalf("place %d: %v", run, err)
		}

		orders = append(orders, res.Msg.GetOrder().GetId())
	}

	measure := func(name string, call func(run int) error) {
		t.Helper()

		err := call(0)
		if err != nil {
			t.Fatalf("%s warm-up: %v", name, err)
		}

		walls := make([]time.Duration, 0, 5)

		for run := 1; run <= 5; run++ {
			probe.Reset()

			var callErr error

			wall, dbTime := probe.Measure(func() {
				callErr = call(run)
			})
			if callErr != nil {
				t.Fatalf("%s run %d: %v", name, run, callErr)
			}

			walls = append(walls, wall)
			t.Logf("%s: wall=%v db=%v go=%v queries=%d", name, wall, dbTime, wall-dbTime, probe.Count())
		}

		t.Logf("%s: MEDIAN wall %v", name, san_perf.Median(walls))
		probe.Report(t, name)

		for _, q := range probe.Queries() {
			sql := strings.TrimSpace(q.SQL)
			if strings.HasPrefix(strings.ToUpper(sql), "SELECT") && !strings.Contains(strings.ToUpper(sql), "FOR UPDATE") {
				san_perf.Explain(t, db, sql)
			}
		}
	}

	measure("OrderCancel — count check, status, event", func(run int) error {
		_, err := svc.OrderCancel(context.Background(), connect.NewRequest(&sellingv1.OrderCancelRequest{
			TeamId: perfTakeTeam, OrderId: orders[run],
		}))

		return err
	})

	if len(cancelled) != 6 {
		t.Fatalf("published %d OrderCancelled, want 6", len(cancelled))
	}

	measure("OrderCancelled listener — releases the take", func(run int) error {
		return inventory.OrderCancelled(context.Background(), cancelled[run])
	})

	measure("OrderCancelled listener — redelivered, already released", func(run int) error {
		return inventory.OrderCancelled(context.Background(), cancelled[run])
	})

	// Every cancelled order's take is back on the shelf.
	var left int64

	db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM batches WHERE warehouse_id = ?`, perfTakeWarehouse).Scan(&left)
	if left != 5_000 {
		t.Fatalf("the warehouse holds %d after the cancels, want all 5000 back", left)
	}
}
