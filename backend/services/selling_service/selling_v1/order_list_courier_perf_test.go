//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for the courier filter after the courier became an id
// (shipment-channel-is-an-id-into-shipment-service): a warehouse's OrderList and OrderStat narrowed to one
// shipment_channel_id over 50 000 orders and eleven couriers.
//
//	go test -tags perfaudit -run 'TestPerf_OrderList_Courier' -v ./backend/services/selling_service/selling_v1/
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

func TestPerf_OrderList_Courier(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	shopIDs := make([]uint64, 0, 10)
	for i := range 10 {
		shopIDs = append(shopIDs, insertShop(t, db, 2, "Toko "+strconv.Itoa(i), "TOKO-"+strconv.Itoa(i), "shopee"))
	}

	orders := perfOrderRows(50_000, shopIDs)
	for i := range orders {
		orders[i].ShipmentChannelID = uint64(1 + i%11)
	}

	san_perf.SeedRows(t, db, orders)

	svc := newService(t, db)
	ctx := t.Context()

	// The warehouse 900's queue (a third of the orders), narrowed to JNE (one in eleven of those).
	list := func() {
		_, err := svc.OrderList(ctx, connect.NewRequest(&sellingv1.OrderListRequest{
			TeamId: 900, Filter: &sellingv1.OrderListFilter{ShipmentChannelId: 1},
			Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
		}))
		if err != nil {
			t.Fatalf("OrderList: %v", err)
		}
	}

	stat := func() {
		_, err := svc.OrderStat(ctx, connect.NewRequest(&sellingv1.OrderStatRequest{
			TeamId: 900, Filter: &sellingv1.OrderStatFilter{ShipmentChannelId: 1},
		}))
		if err != nil {
			t.Fatalf("OrderStat: %v", err)
		}
	}

	list() // warm-up

	for name, call := range map[string]func(){"OrderList": list, "OrderStat": stat} {
		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()
			wall, dbTime := probe.Measure(call)
			walls = append(walls, wall)
			t.Logf("%s wall=%v db=%v queries=%d", name, wall, dbTime, probe.Count())
		}

		t.Logf("%s MEDIAN wall %v", name, san_perf.Median(walls))
		probe.Report(t, name+" — one courier, a warehouse's queue")

		for _, q := range probe.Queries() {
			if strings.Contains(q.SQL, "shipment_channel_id") && !strings.Contains(q.SQL, "SAVEPOINT") {
				t.Log(san_perf.Explain(t, db, q.SQL))

				break
			}
		}
	}
}
