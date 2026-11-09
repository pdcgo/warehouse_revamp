//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for OrderReturnAccept — the-accept-is-the-status-return-completed.
//
//	go test -tags perfaudit -run TestPerf_OrderReturnAccept -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// ONE ACCEPT over 50 000 orders, their lines and ~250 000 timeline rows: the order and its lines by primary key, the
// selling team's return warehouse (its unique team index), the selling team's maps for those lines, then — after the
// stock half, a fake here (inventory's own probe is TestPerf_OrderTransactionReturn) — the order FOR UPDATE, the status
// UPDATE, the return transaction's UPDATE, one timeline INSERT (two with a broken or missing unit). The count must not
// move with anything — there is no list in it.
func TestPerf_OrderReturnAccept(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	orders := seedOrders(t, db)

	items := perfStatItemRows(orders)
	san_perf.SeedRows(t, db, items)

	timeline := perfTimelineRows(orders)
	san_perf.SeedRows(t, db, timeline)

	t.Logf("seed: orders=%d order_items=%d order_timeline_logs=%d", len(orders), len(items), len(timeline))

	// Returns shipping from warehouse 900, deep in the table — an accept is terminal, so each run takes a fresh one.
	var returned []uint64

	for _, o := range orders[25_000:] {
		if o.Status == "return" && o.WarehouseID == testWarehouse {
			returned = append(returned, o.ID)
		}
	}

	if len(returned) < 6 {
		t.Fatalf("only %d returns from warehouse %d in the seed, want 6", len(returned), testWarehouse)
	}

	// The take each return mints from, and every seeded team's return warehouse — the one that shipped them.
	err := db.Exec(`UPDATE orders SET transaction_id = id WHERE id IN ?`, returned).Error
	if err != nil {
		t.Fatalf("give the returns their takes: %v", err)
	}

	for team := uint64(2); team <= 6; team++ {
		configureReturnWarehouse(t, db, team, testWarehouse)
	}

	linesOf := map[uint64][]*sellingv1.OrderReturnAcceptLine{}

	for _, item := range items {
		// One unit of every line broken, so each accept writes its door note too.
		linesOf[item.OrderID] = append(linesOf[item.OrderID], &sellingv1.OrderReturnAcceptLine{
			OrderItemId: item.ID, Broken: 1, Note: "pecah",
			Placements: placementsOf(item.Quantity - 1),
		})
	}

	svc := newService(t, db)
	ctx := asUser(7)

	accept := func(orderID uint64) error {
		_, err := svc.OrderReturnAccept(ctx, connect.NewRequest(&sellingv1.OrderReturnAcceptRequest{
			TeamId: testWarehouse, OrderId: orderID, CourierCharge: 15_000, CourierChargeNote: "ongkir retur",
			Lines: linesOf[orderID],
		}))

		return err
	}

	err = accept(returned[0]) // warm-up
	if err != nil {
		t.Fatalf("OrderReturnAccept warm-up: %v", err)
	}

	walls := make([]time.Duration, 0, 5)

	for _, orderID := range returned[1:6] {
		probe.Reset()

		wall, dbTime := probe.Measure(func() {
			err = accept(orderID)
		})
		if err != nil {
			t.Fatalf("OrderReturnAccept: %v", err)
		}

		walls = append(walls, wall)
		t.Logf("wall=%v db=%v go=%v queries=%d", wall, dbTime, wall-dbTime, probe.Count())
	}

	t.Logf("MEDIAN wall %v", san_perf.Median(walls))
	probe.Report(t, "OrderReturnAccept")

	// The SAVEPOINTs are san_testdb's outer transaction showing through — in production they are BEGIN and COMMIT.
	for _, q := range probe.Queries() {
		if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
			continue
		}

		t.Log(san_perf.Explain(t, db, q.SQL))
	}
}

// placementsOf is a line's sound units on one rack, none when nothing is sound.
func placementsOf(sound uint32) []*sellingv1.OrderReturnPlacement {
	if sound == 0 {
		return nil
	}

	return []*sellingv1.OrderReturnPlacement{{RackId: 77, Quantity: sound}}
}

// THE SCOPE'S THIRD READER (orderReaders): every order read now asks whether the caller is a selling team's configured
// return warehouse. Over 50 000 orders, a warehouse's list and its return warehouse's Returns tab must stay index reads —
// the `= ANY(ARRAY(subquery))` is what lets the three arms be one BitmapOr rather than a scan of every order.
func TestPerf_OrderList_ReturnWarehouse(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	orders := seedOrders(t, db)

	items := perfStatItemRows(orders)
	san_perf.SeedRows(t, db, items)

	configureReturnWarehouse(t, db, 2, configuredReturnWarehouse)

	// The baseline: the two-arm scope this replaced, on the same seed — so a plan below is judged against what it was.
	t.Log(san_perf.Explain(t, db, `SELECT count(*) FROM orders WHERE (team_id = 900 OR warehouse_id = 900)`))
	t.Log(san_perf.Explain(t, db, `SELECT count(*) FROM orders WHERE (team_id = 950 OR warehouse_id = 950) AND status = 'return'`))

	svc := newService(t, db)

	for _, c := range []struct {
		name   string
		team   uint64
		status sellingv1.OrderStatus
	}{
		{"the shipping warehouse, every status", testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED},
		{"the return warehouse, its Returns tab", configuredReturnWarehouse, sellingv1.OrderStatus_ORDER_STATUS_RETURN},
	} {
		list := func() error {
			_, err := svc.OrderList(t.Context(), connect.NewRequest(&sellingv1.OrderListRequest{
				TeamId: c.team,
				Filter: &sellingv1.OrderListFilter{Status: c.status},
				Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
			}))

			return err
		}

		err := list() // warm-up
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		probe.Reset()

		wall, dbTime := probe.Measure(func() {
			err = list()
		})
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		t.Logf("%s: wall=%v db=%v queries=%d", c.name, wall, dbTime, probe.Count())

		for _, q := range probe.Queries() {
			if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
				continue
			}

			t.Log(san_perf.Explain(t, db, q.SQL))
		}
	}
}
