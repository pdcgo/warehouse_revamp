//go:build perfaudit

package selling_v1_test

import (
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// OrderPrintByIds over perfOrderRows' 50 000 orders (five teams, three warehouses), half with a label: a full print of 50
// of the warehouse's own orders, 50 ids of which a third are its own (the rest another building's — left out), and the
// root team's 50 — one primary-key read each time, whatever the count.
func TestPerf_OrderPrintByIds(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	shopIDs := make([]uint64, 0, 10)
	for i := range 10 {
		shopIDs = append(shopIDs, insertShop(t, db, 2, "Toko "+strconv.Itoa(i), "TOKO-"+strconv.Itoa(i), "shopee"))
	}

	rows := perfOrderRows(50_000, shopIDs)
	for i := range rows {
		if i%2 == 0 {
			rows[i].ReceiptDocumentID = "doc-" + strconv.Itoa(i)
		}
	}

	san_perf.SeedRows(t, db, rows)

	svc := newService(t, db)
	ctx := t.Context()

	// Row r ships from warehouse 900 + r % 3: every third row from 25 000 is warehouse 900 + 25 000 % 3's own.
	own := make([]uint64, 0, 50)
	mixed := make([]uint64, 0, 50)
	for i := 0; len(own) < 50; i++ {
		own = append(own, rows[25_000+i*3].ID)
	}
	for i := range 50 {
		mixed = append(mixed, rows[30_000+i].ID)
	}

	warehouse := rows[25_000].WarehouseID

	calls := map[string]struct {
		teamID uint64
		ids    []uint64
	}{
		"OrderPrintByIds 50 own":              {warehouse, own},
		"OrderPrintByIds 50, a third own":     {warehouse, mixed},
		"OrderPrintByIds 50 as the root team": {san_auth.RootTeamID, mixed},
	}

	for name, call := range calls {
		run := func() error {
			_, err := svc.OrderPrintByIds(ctx, connect.NewRequest(&sellingv1.OrderPrintByIdsRequest{
				TeamId: call.teamID, OrderIds: call.ids,
			}))

			return err
		}

		err := run()
		if err != nil {
			t.Fatalf("%s warm-up: %v", name, err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() { err = run() })
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}

			if probe.Count() != 1 {
				t.Fatalf("%s: %d statements, want 1", name, probe.Count())
			}

			walls = append(walls, wall)
			t.Logf("%s wall=%v db=%v queries=%d", name, wall, dbTime, probe.Count())
		}

		t.Logf("%s MEDIAN wall %v", name, san_perf.Median(walls))

		for _, q := range probe.Queries() {
			t.Log(san_perf.Explain(t, db, q.SQL))
		}
	}
}
