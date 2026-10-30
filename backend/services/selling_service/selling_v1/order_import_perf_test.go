//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for the order import — ShopeeOrderImport, which shares
// importOrders with TiktokOrderImport; only the reader differs.
//
//	go test -tags perfaudit -run 'TestPerf_OrderImport' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// THE IMPORT at two file sizes — 200 orders and 1 000 — over 50 000 orders in ten shops. Every order in the file is
// `shipping` here and "Sedang Dikirim" on the platform, so every one MOVES: the worst case, all writes.
func TestPerf_OrderImport(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	shops := make([]uint64, 0, 10)
	for i := range 10 {
		shops = append(shops, insertShop(t, db, 2, "Toko "+strconv.Itoa(i), "TOKO-"+strconv.Itoa(i), "shopee"))
	}

	// The imported shop holds a fifth of the rows, two thirds of them shipping; the rest spread over every status.
	statuses := []string{"pending", "processed", "picked", "shipped", "completed", "return", "cancel"}
	rows := make([]selling_service_models.Order, 0, 50_000)
	var shipping []string

	for i := range 50_000 {
		ref := fmt.Sprintf("26%012X", i)
		shop := shops[i%10]
		status := statuses[i%len(statuses)]

		if i%5 == 0 {
			shop = shops[0]
			if i%3 != 0 {
				status = "shipping"
				shipping = append(shipping, ref)
			}
		}

		rows = append(rows, selling_service_models.Order{
			TeamID: 2, ShopID: shop, WarehouseID: testWarehouse, Status: status,
			OrderExternalRefID: ref, CustomerName: "Budi",
		})
	}

	san_perf.SeedRows(t, db, rows)

	mux := http.NewServeMux()
	mux.Handle(sellingv1connect.NewOrderServiceHandler(newService(t, db)))

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	client := sellingv1connect.NewOrderServiceClient(server.Client(), server.URL)

	take := func(n int) []byte {
		if len(shipping) < n {
			t.Fatalf("only %d shipping orders left, want %d", len(shipping), n)
		}

		var file strings.Builder
		file.WriteString("No. Pesanan,Status Pesanan,Status Pembatalan/ Pengembalian\n")

		for _, ref := range shipping[:n] {
			file.WriteString(ref + ",Sedang Dikirim,\n")
		}

		shipping = shipping[n:]

		return []byte(file.String())
	}

	run := func(content []byte) *sellingv1.OrderImportTally {
		stream, err := client.ShopeeOrderImport(context.Background(), connect.NewRequest(&sellingv1.ShopeeOrderImportRequest{
			TeamId: 2, ShopId: shops[0], FileContent: content,
		}))
		if err != nil {
			t.Fatalf("ShopeeOrderImport: %v", err)
		}
		defer stream.Close()

		var tally *sellingv1.OrderImportTally

		for stream.Receive() {
			if stream.Msg().GetTally() != nil {
				tally = stream.Msg().GetTally()
			}
		}

		if stream.Err() != nil {
			t.Fatalf("stream: %v", stream.Err())
		}

		return tally
	}

	run(take(20)) // warm-up

	for _, size := range []int{200, 1_000} {
		walls := make([]time.Duration, 0, 3)

		for range 3 {
			file := take(size)

			probe.Reset()

			var tally *sellingv1.OrderImportTally

			wall, dbTime := probe.Measure(func() { tally = run(file) })

			if tally.GetMoved() != uint32(size) {
				t.Fatalf("moved %d of %d", tally.GetMoved(), size)
			}

			walls = append(walls, wall)
			t.Logf("orders=%d wall=%v db=%v go=%v queries=%d", size, wall, dbTime, wall-dbTime, probe.Count())
		}

		t.Logf("orders=%d MEDIAN wall %v", size, san_perf.Median(walls))
		probe.Report(t, "ShopeeOrderImport "+strconv.Itoa(size))
	}

	// The ref lookup and one batch's statements, EXPLAINed on the seeded rows.
	probe.Reset()
	run(take(200))

	for _, q := range probe.Queries() {
		if strings.HasPrefix(q.SQL, "SAVEPOINT") || strings.HasPrefix(q.SQL, "RELEASE") {
			continue
		}

		if strings.Contains(q.SQL, "order_external_ref_id IN") || strings.Contains(q.SQL, "FOR UPDATE") || strings.HasPrefix(q.SQL, "INSERT") || strings.HasPrefix(q.SQL, "UPDATE") {
			t.Log(san_perf.Explain(t, db, q.SQL))
		}
	}
}
