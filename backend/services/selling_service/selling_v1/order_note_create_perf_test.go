//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for OrderNoteCreate — a-note-is-a-timeline-row.
//
//	go test -tags perfaudit -run TestPerf_OrderNoteCreate -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"testing"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// ONE NOTE, from each end, over 50 000 orders and their ~250 000 timeline rows: the scoped read of one order by its
// primary key, then one INSERT. The count must not move with anything — there is no list in it.
func TestPerf_OrderNoteCreate(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	orders := seedOrders(t, db)

	timeline := perfTimelineRows(orders)
	san_perf.SeedRows(t, db, timeline)

	t.Logf("seed: orders=%d order_timeline_logs=%d", len(orders), len(timeline))

	svc := newService(t, db)
	ctx := asUser(7)

	// An order deep in the table: team 2, shipping from 900 (perfOrderRows: team 2 + i%5, warehouse 900 + i%3).
	target := orders[30_000]
	if target.TeamID != 2 || target.WarehouseID != 900 {
		t.Fatalf("seed order %d is team %d / warehouse %d, want 2 / 900", target.ID, target.TeamID, target.WarehouseID)
	}

	for _, side := range []struct {
		name string
		team uint64
	}{
		{"selling", target.TeamID},
		{"warehouse", target.WarehouseID},
	} {
		req := &sellingv1.OrderNoteCreateRequest{TeamId: side.team, OrderId: target.ID, Note: "no goods on Rak A"}

		_, err := svc.OrderNoteCreate(ctx, connect.NewRequest(req)) // warm-up
		if err != nil {
			t.Fatalf("OrderNoteCreate warm-up: %v", err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				_, err = svc.OrderNoteCreate(ctx, connect.NewRequest(req))
			})
			if err != nil {
				t.Fatalf("OrderNoteCreate: %v", err)
			}

			walls = append(walls, wall)
			t.Logf("%s: wall=%v db=%v go=%v queries=%d", side.name, wall, dbTime, wall-dbTime, probe.Count())
		}

		t.Logf("%s: MEDIAN wall %v", side.name, san_perf.Median(walls))
		probe.Report(t, "OrderNoteCreate — "+side.name)

		for _, q := range probe.Queries() {
			t.Log(san_perf.Explain(t, db, q.SQL))
		}
	}
}
