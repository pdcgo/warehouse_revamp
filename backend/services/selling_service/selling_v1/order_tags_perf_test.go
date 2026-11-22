//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for the ORDER TAGS' filter (the-order-tags-prototype-is-accepted):
// OrderList and OrderStat with `tag_ids` (any of) over 50 000 orders in five selling teams and three warehouses, as the
// seller (team 2, 10 000 orders) and as the warehouse (900, a third of them). Three tags: a common one on one order in
// seven, a middling one on one in 53, a rare one on one in 503 (moduli prime to the teams' 5 and the warehouses' 3, so
// every reader holds each). Each pick is measured without and with
// 00055's `order_tag_links_tag_idx` (tag_id, order_id), in ONE process on ONE seed, and under a forced generic plan
// too. The unfiltered list's page also reads its tags now (one statement per page) — logged with its query count.
//
//	go test -tags perfaudit -run 'TestPerf_OrderList_TagFilter' -v ./backend/services/selling_service/selling_v1/
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

func TestPerf_OrderList_TagFilter(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	shopIDs := make([]uint64, 0, 10)
	for i := range 10 {
		shopIDs = append(shopIDs, insertShop(t, db, 2, "Toko "+strconv.Itoa(i), "TOKO-"+strconv.Itoa(i), "shopee"))
	}

	san_perf.SeedRows(t, db, perfOrderRows(50_000, shopIDs))

	common := otSeed(t, db, "perf-Umum", "custom")
	middling := otSeed(t, db, "perf-Sedang", "custom")
	rare := otSeed(t, db, "perf-Langka", "system")

	for _, sql := range []string{
		`INSERT INTO order_tag_links (order_id, tag_id) SELECT id, ` + strconv.FormatUint(common, 10) + ` FROM orders WHERE id % 7 = 0`,
		`INSERT INTO order_tag_links (order_id, tag_id) SELECT id, ` + strconv.FormatUint(middling, 10) + ` FROM orders WHERE id % 53 = 3`,
		`INSERT INTO order_tag_links (order_id, tag_id) SELECT id, ` + strconv.FormatUint(rare, 10) + ` FROM orders WHERE id % 503 = 7`,
		`ANALYZE orders`,
		`ANALYZE order_tag_links`,
	} {
		err := db.Exec(sql).Error
		if err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}

	for _, team := range []uint64{2, 900} {
		for _, tag := range []uint64{common, middling, rare} {
			var n int64

			err := db.Raw(`SELECT count(*) FROM order_tag_links l JOIN orders o ON o.id = l.order_id
				WHERE l.tag_id = ? AND (o.team_id = ? OR o.warehouse_id = ?)`, tag, team, team).Scan(&n).Error
			if err != nil {
				t.Fatal(err)
			}

			t.Logf("team %d reads %d orders carrying tag %d", team, n, tag)
		}
	}

	svc := newService(t, db)
	ctx := t.Context()

	list := func(team uint64, tags []uint64) func() {
		return func() {
			_, err := svc.OrderList(ctx, connect.NewRequest(&sellingv1.OrderListRequest{
				TeamId: team, Filter: &sellingv1.OrderListFilter{TagIds: tags},
				Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
			}))
			if err != nil {
				t.Fatalf("OrderList: %v", err)
			}
		}
	}

	stat := func(team uint64, tags []uint64) func() {
		return func() {
			_, err := svc.OrderStat(ctx, connect.NewRequest(&sellingv1.OrderStatRequest{
				TeamId: team, Filter: &sellingv1.OrderStatFilter{TagIds: tags},
			}))
			if err != nil {
				t.Fatalf("OrderStat: %v", err)
			}
		}
	}

	picks := []struct {
		name string
		tags []uint64
	}{
		{"no tag", nil},
		{"rare", []uint64{rare}},
		{"middling", []uint64{middling}},
		{"common", []uint64{common}},
		{"rare or common", []uint64{rare, common}},
	}

	measure := func(label string) {
		for _, team := range []uint64{2, 900} {
			for _, pick := range picks {
				for _, c := range []struct {
					name string
					call func()
				}{
					{"OrderList", list(team, pick.tags)},
					{"OrderStat", stat(team, pick.tags)},
				} {
					c.call() // warm-up

					walls := make([]time.Duration, 0, 7)

					for range 7 {
						probe.Reset()
						wall, _ := probe.Measure(c.call)
						walls = append(walls, wall)
					}

					t.Logf("%s · team %d · %s (%s) MEDIAN wall %v, queries %d", label, team, c.name, pick.name, san_perf.Median(walls),
						probe.Count())
				}
			}

			// The plans of the list's count and page under the rare and the common pick.
			for _, pick := range picks[1:] {
				if pick.name != "rare" && pick.name != "common" {
					continue
				}

				probe.Reset()
				list(team, pick.tags)()

				for _, q := range probe.Queries() {
					if strings.Contains(q.SQL, "order_tag_links otl") && !strings.Contains(q.SQL, "SAVEPOINT") {
						t.Logf("%s · team %d · %s · plan:\n%s", label, team, pick.name, san_perf.Explain(t, db, q.SQL))
					}
				}
			}
		}

		// The page's tags (orderTagsOf) — the one statement every list page now adds.
		probe.Reset()
		list(2, nil)()

		for _, q := range probe.Queries() {
			if strings.Contains(q.SQL, "FROM \"order_tag_links\"") && !strings.Contains(q.SQL, "SAVEPOINT") {
				t.Logf("%s · the page's tags · plan:\n%s", label, san_perf.Explain(t, db, q.SQL))
			}
		}
	}

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

	// Without the tag-side index first — dropped inside the test's transaction, so it comes back with the rollback.
	err := db.Exec(`DROP INDEX order_tag_links_tag_idx`).Error
	if err != nil {
		t.Fatal(err)
	}

	err = db.Exec(`ANALYZE order_tag_links`).Error
	if err != nil {
		t.Fatal(err)
	}

	measure("WITHOUT order_tag_links_tag_idx")
	generic("WITHOUT order_tag_links_tag_idx")

	err = db.Exec(`CREATE INDEX order_tag_links_tag_idx ON order_tag_links (tag_id, order_id)`).Error
	if err != nil {
		t.Fatal(err)
	}

	err = db.Exec(`ANALYZE order_tag_links`).Error
	if err != nil {
		t.Fatal(err)
	}

	measure("WITH order_tag_links_tag_idx")
	generic("WITH order_tag_links_tag_idx")
}
