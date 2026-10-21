//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for the order-context RPCs of the 2026-10-21 pass:
// OrderStatusChange, OrderList as the root team reads it (every team, no team clause), and the return
// warehouse's Detail and Set.
//
//	go test -tags perfaudit -run 'TestPerf_OrderStatusChange|TestPerf_OrderList_Root|TestPerf_TeamReturnConfiguration' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// seedOrders seeds perfOrderRows' 50 000 orders over ten shops and returns them.
func seedOrders(t *testing.T, db *gorm.DB) []selling_service_models.Order {
	t.Helper()

	shopIDs := make([]uint64, 0, 10)
	for i := range 10 {
		shopIDs = append(shopIDs, insertShop(t, db, 2, "Toko "+strconv.Itoa(i), "TOKO-"+strconv.Itoa(i), "shopee"))
	}

	rows := perfOrderRows(50_000, shopIDs)
	san_perf.SeedRows(t, db, rows)

	return rows
}

// THE BATCH MOVE at two batch sizes — a handover scan of 20 parcels and one of 200. Each order is its own
// transaction by design (one-status-change-for-every-plain-move), so the query count is EXPECTED to grow with
// the batch; what this measures is what that costs.
func TestPerf_OrderStatusChange(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	rows := seedOrders(t, db)

	// Processed orders shipping from warehouse 900 — the ones its crew may pick.
	var processed []uint64

	for _, r := range rows {
		if r.Status == "processed" && r.WarehouseID == 900 {
			processed = append(processed, r.ID)
		}
	}

	svc := newService(t, db)
	ctx := t.Context()

	take := func(n int) []uint64 {
		if len(processed) < n {
			t.Fatalf("only %d processed orders left, want %d", len(processed), n)
		}

		ids := processed[:n]
		processed = processed[n:]

		return ids
	}

	move := func(ids []uint64) {
		res, err := svc.OrderStatusChange(ctx, connect.NewRequest(&sellingv1.OrderStatusChangeRequest{
			TeamId: 900, OrderIds: ids, To: sellingv1.OrderStatus_ORDER_STATUS_PICKED,
		}))
		if err != nil {
			t.Fatalf("OrderStatusChange: %v", err)
		}

		for _, r := range res.Msg.GetResults() {
			if !r.GetMoved() {
				t.Fatalf("order %d refused: %s", r.GetOrderId(), r.GetRefusedReason())
			}
		}
	}

	move(take(5)) // warm-up

	for _, batch := range []int{20, 200} {
		walls := make([]time.Duration, 0, 5)

		for range 5 {
			ids := take(batch)

			probe.Reset()

			wall, dbTime := probe.Measure(func() { move(ids) })

			walls = append(walls, wall)
			t.Logf("batch=%d wall=%v db=%v go=%v queries=%d", batch, wall, dbTime, wall-dbTime, probe.Count())
		}

		t.Logf("batch=%d MEDIAN wall %v", batch, san_perf.Median(walls))
		probe.Report(t, "OrderStatusChange batch "+strconv.Itoa(batch))
	}

	probe.Reset()
	move(take(1))

	// One order's statements. The SAVEPOINTs are san_testdb's outer transaction showing through — in production
	// they are BEGIN and COMMIT — and cannot be EXPLAINed.
	for _, q := range probe.Queries() {
		if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
			continue
		}

		t.Log(san_perf.Explain(t, db, q.SQL))
	}
}

// ROOT READS EVERY TEAM — no team clause, so this is the whole orders table: the count, and the page.
func TestPerf_OrderList_Root(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	seedOrders(t, db)

	svc := newService(t, db)
	ctx := t.Context()

	cases := []struct {
		name   string
		filter *sellingv1.OrderListFilter
		limit  uint32
	}{
		{"all, 20", &sellingv1.OrderListFilter{}, 20},
		{"all, 200", &sellingv1.OrderListFilter{}, 200},
		{"one status tab, 20", &sellingv1.OrderListFilter{Status: sellingv1.OrderStatus_ORDER_STATUS_PROCESSED}, 20},
	}

	for _, c := range cases {
		req := &sellingv1.OrderListRequest{
			TeamId: san_auth.RootTeamID,
			Filter: c.filter,
			Page:   &commonv1.CommonPagination{Page: 1, Limit: c.limit},
		}

		_, err := svc.OrderList(ctx, connect.NewRequest(req)) // warm-up
		if err != nil {
			t.Fatalf("OrderList warm-up: %v", err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				_, err = svc.OrderList(ctx, connect.NewRequest(req))
			})
			if err != nil {
				t.Fatalf("OrderList: %v", err)
			}

			walls = append(walls, wall)
			t.Logf("%s: wall=%v db=%v go=%v queries=%d", c.name, wall, dbTime, wall-dbTime, probe.Count())
		}

		t.Logf("%s: MEDIAN wall %v", c.name, san_perf.Median(walls))
		probe.Report(t, "OrderList root — "+c.name)

		for _, q := range probe.Queries() {
			t.Log(san_perf.Explain(t, db, q.SQL))
		}
	}
}

// The return warehouse: one row by a unique key, read and upserted, over 10 000 teams' rows.
func TestPerf_TeamReturnConfiguration(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	rows := make([]selling_service_models.TeamReturnConfiguration, 0, 10_000)
	for i := range 10_000 {
		rows = append(rows, selling_service_models.TeamReturnConfiguration{
			TeamID: uint64(100_000 + i), WarehouseID: uint64(900 + i%3), CreatedAt: time.Now(), UpdatedAt: time.Now(),
		})
	}

	san_perf.SeedRows(t, db, rows)

	svc := newService(t, db)
	ctx := t.Context()

	detail := &sellingv1.TeamReturnConfigurationDetailRequest{TeamId: 105_000}
	set := &sellingv1.TeamReturnConfigurationSetRequest{TeamId: 105_000, WarehouseId: 41}

	// Root's Teams list asks for a page of teams at once: 200 ids, half of them with a row.
	teamIDs := make([]uint64, 0, 200)
	for i := range 200 {
		teamIDs = append(teamIDs, uint64(109_900+i))
	}

	byIds := &sellingv1.TeamReturnConfigurationByIdsRequest{Filter: &sellingv1.TeamReturnConfigurationByIdsFilter{Ids: teamIDs}}

	for _, rpc := range []struct {
		name string
		call func() error
	}{
		{"Detail", func() error {
			_, err := svc.TeamReturnConfigurationDetail(ctx, connect.NewRequest(detail))

			return err
		}},
		{"Set", func() error {
			_, err := svc.TeamReturnConfigurationSet(ctx, connect.NewRequest(set))

			return err
		}},
		{"ByIds 200", func() error {
			_, err := svc.TeamReturnConfigurationByIds(ctx, connect.NewRequest(byIds))

			return err
		}},
	} {
		err := rpc.call() // warm-up
		if err != nil {
			t.Fatalf("%s warm-up: %v", rpc.name, err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() { err = rpc.call() })
			if err != nil {
				t.Fatalf("%s: %v", rpc.name, err)
			}

			walls = append(walls, wall)
			t.Logf("%s: wall=%v db=%v queries=%d", rpc.name, wall, dbTime, probe.Count())
		}

		t.Logf("%s: MEDIAN wall %v", rpc.name, san_perf.Median(walls))
		probe.Report(t, "TeamReturnConfiguration"+rpc.name)

		for _, q := range probe.Queries() {
			t.Log(san_perf.Explain(t, db, q.SQL))
		}
	}
}
