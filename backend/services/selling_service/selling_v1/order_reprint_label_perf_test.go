//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for Perlu cetak ulang (the-reprint-label-prototype-is-accepted):
// the warehouse list's OrderList and OrderStat with OrderListFilter / OrderStatFilter `reprint_label` on, over 50 000
// orders — a third shipping from warehouse 900 — four in five printed, about one in a hundred changed after. Measured
// without the filter (today's list) and with it, both without and with 00054's partial index orders_reprint_label_idx,
// in ONE process on ONE seed, and under a forced generic plan too.
//
//	go test -tags perfaudit -run 'TestPerf_OrderList_ReprintLabel' -v ./backend/services/selling_service/selling_v1/
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

func TestPerf_OrderList_ReprintLabel(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	shopIDs := make([]uint64, 0, 10)
	for i := range 10 {
		shopIDs = append(shopIDs, insertShop(t, db, 2, "Toko "+strconv.Itoa(i), "TOKO-"+strconv.Itoa(i), "shopee"))
	}

	san_perf.SeedRows(t, db, perfOrderRows(50_000, shopIDs))

	// Four in five printed an hour after placement; one in 97 changed two hours after (after the print, unless that
	// order was never printed) and one in 89 half an hour after (before the print).
	for _, sql := range []string{
		`UPDATE orders SET label_printed_at = created_at + interval '1 hour' WHERE id % 5 <> 0`,
		`UPDATE orders SET receipt_changed_at = created_at + interval '2 hours' WHERE id % 97 = 0`,
		`UPDATE orders SET receipt_changed_at = created_at + interval '30 minutes' WHERE id % 89 = 0`,
		`ANALYZE orders`,
	} {
		err := db.Exec(sql).Error
		if err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}

	var marked, ours int64

	err := db.Raw(`SELECT count(*) FILTER (WHERE `+"(label_printed_at IS NOT NULL AND receipt_changed_at > label_printed_at AND status IN ('pending', 'processed', 'picked'))"+`),
		count(*) FROM orders WHERE warehouse_id = 900`).
		Row().
		Scan(&marked, &ours)
	if err != nil {
		t.Fatal(err)
	}

	t.Logf("warehouse 900 ships %d orders, %d of them marked Cetak ulang label", ours, marked)

	svc := newService(t, db)
	ctx := t.Context()

	list := func(reprint bool) func() {
		return func() {
			res, err := svc.OrderList(ctx, connect.NewRequest(&sellingv1.OrderListRequest{
				TeamId: 900, Filter: &sellingv1.OrderListFilter{ReprintLabel: reprint},
				Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
			}))
			if err != nil {
				t.Fatalf("OrderList: %v", err)
			}

			if reprint && int64(res.Msg.GetPageInfo().GetTotalItems()) != marked {
				t.Fatalf("Perlu cetak ulang counts %d, want %d", res.Msg.GetPageInfo().GetTotalItems(), marked)
			}
		}
	}

	stat := func(reprint bool) func() {
		return func() {
			_, err := svc.OrderStat(ctx, connect.NewRequest(&sellingv1.OrderStatRequest{
				TeamId: 900, Filter: &sellingv1.OrderStatFilter{ReprintLabel: reprint},
			}))
			if err != nil {
				t.Fatalf("OrderStat: %v", err)
			}
		}
	}

	measure := func(label string) {
		calls := []struct {
			name string
			call func()
		}{
			{"OrderList (no filter)", list(false)},
			{"OrderList (Perlu cetak ulang)", list(true)},
			{"OrderStat (no filter)", stat(false)},
			{"OrderStat (Perlu cetak ulang)", stat(true)},
		}

		for _, c := range calls {
			c.call() // warm-up

			walls := make([]time.Duration, 0, 7)

			for range 7 {
				probe.Reset()
				wall, _ := probe.Measure(c.call)
				walls = append(walls, wall)
			}

			t.Logf("%s · %s MEDIAN wall %v, queries %d", label, c.name, san_perf.Median(walls), probe.Count())
		}

		probe.Reset()
		list(true)()

		for _, q := range probe.Queries() {
			if strings.Contains(q.SQL, "receipt_changed_at > label_printed_at") && !strings.Contains(q.SQL, "SAVEPOINT") {
				t.Logf("%s · the filtered list's plan:\n%s", label, san_perf.Explain(t, db, q.SQL))
			}
		}
	}

	// pgx prepares every statement, and after five runs Postgres may switch to a GENERIC plan: the index must hold there
	// too (its predicate is literals, the scope a parameter).
	generic := func(label string) {
		err := db.Exec(`SET LOCAL plan_cache_mode = force_generic_plan`).Error
		if err != nil {
			t.Fatal(err)
		}

		measure(label + " · generic plan")

		err = db.Exec(`SET LOCAL plan_cache_mode = auto`).Error
		if err != nil {
			t.Fatal(err)
		}
	}

	// Without the index first — as the list read before 00054 added it. Dropped inside the test's transaction, so it
	// comes back with the rollback.
	err = db.Exec(`DROP INDEX orders_reprint_label_idx`).Error
	if err != nil {
		t.Fatal(err)
	}

	measure("WITHOUT an index")
	generic("WITHOUT an index")

	// The migration's index (00054, a-pure-index-is-added-without-asking): only the marked orders, by id — the list's
	// newest-first order. Put back after the run without it, inside the test's transaction.
	err = db.Exec(`CREATE INDEX orders_reprint_label_idx ON orders (id)
		WHERE label_printed_at IS NOT NULL AND receipt_changed_at > label_printed_at
		AND status IN ('pending', 'processed', 'picked')`).Error
	if err != nil {
		t.Fatal(err)
	}

	err = db.Exec(`ANALYZE orders`).Error
	if err != nil {
		t.Fatal(err)
	}

	measure("WITH orders_reprint_label_idx")
	generic("WITH orders_reprint_label_idx")
}
