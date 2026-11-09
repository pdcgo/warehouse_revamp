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

// OrderLabels over perfOrderRows' 50 000 orders (five teams, three warehouses), every one with a label: the warehouse's
// own order, another warehouse's, and the root team's — one primary-key lookup each, then the link.
func TestPerf_OrderLabels(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	shopIDs := make([]uint64, 0, 10)
	for i := range 10 {
		shopIDs = append(shopIDs, insertShop(t, db, 2, "Toko "+strconv.Itoa(i), "TOKO-"+strconv.Itoa(i), "shopee"))
	}

	rows := perfOrderRows(50_000, shopIDs)
	for i := range rows {
		rows[i].ReceiptDocumentID = "doc-" + strconv.Itoa(i)
	}

	san_perf.SeedRows(t, db, rows)

	linker := &fakeLinker{owners: map[string]uint64{}}
	for i := range rows {
		linker.owners[rows[i].ReceiptDocumentID] = rows[i].TeamID
	}

	svc := labelService(db, linker)
	ctx := t.Context()

	// Row 25 000 ships from warehouse 900 + 25 000 % 3.
	order := rows[25_000]

	calls := map[string]func() error{
		"OrderLabels own": func() error {
			res, err := svc.OrderLabels(ctx, connect.NewRequest(&sellingv1.OrderLabelsRequest{
				TeamId: order.WarehouseID, OrderIds: []uint64{order.ID},
			}))
			if err == nil && !res.Msg.GetResults()[0].GetIncluded() {
				t.Fatalf("own: %v", res.Msg)
			}

			return err
		},
		"OrderLabels another warehouse": func() error {
			_, err := svc.OrderLabels(ctx, connect.NewRequest(&sellingv1.OrderLabelsRequest{
				TeamId: 900 + (order.WarehouseID-900+1)%3, OrderIds: []uint64{order.ID},
			}))

			return err
		},
		"OrderLabels root": func() error {
			_, err := svc.OrderLabels(ctx, connect.NewRequest(&sellingv1.OrderLabelsRequest{
				TeamId: san_auth.RootTeamID, OrderIds: []uint64{order.ID},
			}))

			return err
		},
	}

	for name, call := range calls {
		err := call()
		if err != nil {
			t.Fatalf("%s warm-up: %v", name, err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() { err = call() })
			if err != nil {
				t.Fatalf("%s: %v", name, err)
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
