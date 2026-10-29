//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for OrderReceiptUpdate — the-seller-edits-the-resi-until-handover.
//
//	go test -tags perfaudit -run TestPerf_OrderReceiptUpdate -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// ONE EDIT over 50 000 orders, their lines and ~250 000 timeline rows: the order FOR UPDATE by its primary key, its
// lines, one UPDATE of its row and one note INSERT. The count must not move with anything — there is no list in it.
func TestPerf_OrderReceiptUpdate(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	orders := seedOrders(t, db)

	items := perfStatItemRows(orders)
	san_perf.SeedRows(t, db, items)

	timeline := perfTimelineRows(orders)
	san_perf.SeedRows(t, db, timeline)

	t.Logf("seed: orders=%d order_items=%d order_timeline_logs=%d", len(orders), len(items), len(timeline))

	svc := newService(t, db)
	ctx := asUser(7)

	// A pending order of team 2, deep in the table.
	var target uint64

	for _, o := range orders[25_000:] {
		if o.TeamID == 2 && o.Status == "pending" {
			target = o.ID

			break
		}
	}

	edit := func(i int) error {
		code := fmt.Sprintf("JNE-%d", i)
		_, err := svc.OrderReceiptUpdate(ctx, connect.NewRequest(&sellingv1.OrderReceiptUpdateRequest{
			TeamId: 2, OrderId: target, ReceiptCode: &code,
		}))

		return err
	}

	err := edit(-1) // warm-up
	if err != nil {
		t.Fatalf("OrderReceiptUpdate warm-up: %v", err)
	}

	walls := make([]time.Duration, 0, 5)

	for i := range 5 {
		probe.Reset()

		wall, dbTime := probe.Measure(func() {
			err = edit(i)
		})
		if err != nil {
			t.Fatalf("OrderReceiptUpdate: %v", err)
		}

		walls = append(walls, wall)
		t.Logf("wall=%v db=%v go=%v queries=%d", wall, dbTime, wall-dbTime, probe.Count())
	}

	t.Logf("MEDIAN wall %v", san_perf.Median(walls))
	probe.Report(t, "OrderReceiptUpdate")

	// The SAVEPOINTs are san_testdb's outer transaction showing through — in production they are BEGIN and COMMIT.
	for _, q := range probe.Queries() {
		if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
			continue
		}

		t.Log(san_perf.Explain(t, db, q.SQL))
	}
}
