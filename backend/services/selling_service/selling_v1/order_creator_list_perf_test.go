//go:build perfaudit

package selling_v1_test

import (
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The "created by" picker's feed, and the list narrowed by it, over perfOrderRows' 50 000 orders (five teams of
// 10 000, three warehouses) — each typed in by one of 40 people.
func TestPerf_OrderCreatorList(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	shopIDs := make([]uint64, 0, 10)
	for i := range 10 {
		shopIDs = append(shopIDs, insertShop(t, db, 2, "Toko "+strconv.Itoa(i), "TOKO-"+strconv.Itoa(i), "shopee"))
	}

	rows := perfOrderRows(50_000, shopIDs)
	for i := range rows {
		rows[i].CreatedByUserID = uint64(100 + i%40)
	}

	san_perf.SeedRows(t, db, rows)

	svc := newService(t, db)
	ctx := t.Context()

	calls := map[string]func() error{
		"OrderCreatorList seller": func() error {
			_, err := svc.OrderCreatorList(ctx, connect.NewRequest(&sellingv1.OrderCreatorListRequest{
				TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 200},
			}))

			return err
		},
		"OrderCreatorList warehouse": func() error {
			_, err := svc.OrderCreatorList(ctx, connect.NewRequest(&sellingv1.OrderCreatorListRequest{
				TeamId: 900, Page: &commonv1.CommonPagination{Page: 1, Limit: 200},
			}))

			return err
		},
		"OrderList by creator": func() error {
			_, err := svc.OrderList(ctx, connect.NewRequest(&sellingv1.OrderListRequest{
				TeamId: 2, Filter: &sellingv1.OrderListFilter{CreatedByUserId: 105},
				Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
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
