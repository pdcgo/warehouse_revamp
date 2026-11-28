//go:build perfaudit

// Performance audit for the PRODUCT TAGS through the REAL wiring (backlog #147, the audit-rpc-performance skill): the
// warehouse's Products list (WarehouseStockList → the reader → SearchAmong) now reads each page's tags and takes a Tag
// filter, and the warehouse product page's ProductTagsByIds asks inventory's batches which products the warehouse holds
// (HeldAmong). WarehouseProductSearch's seed (perfPickerVolume: 30 000 products, 70 000 batches; W2 holds 10 000) and the
// shelves (perfStockShelves), with tags on the catalogue: a common one on 1 in 7 products, a rare one on 1 in 503.
//
//	go test -tags perfaudit -p 1 -count=1 -run TestPerf_ProductTagsThroughTheWiring -v ./backend/cmd/app_development/
package main

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

func TestPerf_ProductTagsThroughTheWiring(t *testing.T) {
	raw := san_testdb.DB(t)
	perfPickerVolume(t, raw)
	perfStockShelves(t, raw)

	var common, rare uint64

	for _, tag := range []struct {
		id   *uint64
		name string
	}{{&common, "perf-wire-Umum"}, {&rare, "perf-wire-Langka"}} {
		err := raw.Raw(`INSERT INTO product_tags (name, type) VALUES (?, 'custom') RETURNING id`, tag.name).Scan(tag.id).Error
		if err != nil {
			t.Fatal(err)
		}
	}

	for _, sql := range []string{
		`INSERT INTO product_tag_links (product_id, tag_id) SELECT id, ` + strconv.FormatUint(common, 10) +
			` FROM products WHERE product_code LIKE 'PF-%' AND id % 7 = 0`,
		`INSERT INTO product_tag_links (product_id, tag_id) SELECT id, ` + strconv.FormatUint(rare, 10) +
			` FROM products WHERE product_code LIKE 'PF-%' AND id % 503 = 7`,
		`ANALYZE product_tag_links`,
	} {
		err := raw.Exec(sql).Error
		if err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}

	db, probe := san_perf.Wrap(raw)
	products := product_v1.NewService(db, nil, nil, NewProductStockNarrower(db), nil)
	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, NewInventoryProductReader(products), nil, nil, nil, nil)
	ctx := context.Background()

	timed := func(name string, call func() string) {
		t.Logf("%s: %s", name, call()) // warm-up, and what it answered

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() { call() })
			walls = append(walls, wall)
			t.Logf("%s: wall=%v db=%v queries=%d", name, wall, dbTime, probe.Count())
		}

		t.Logf("%s: MEDIAN wall %v", name, san_perf.Median(walls))
	}

	list := func(warehouse uint64, tags []uint64) func() string {
		return func() string {
			res, err := inventory.WarehouseStockList(ctx, connect.NewRequest(&inventoryv1.WarehouseStockListRequest{
				WarehouseId: warehouse,
				Filter:      &inventoryv1.WarehouseStockListFilter{TagIds: tags},
				Page:        &commonv1.CommonPagination{Page: 1, Limit: 20},
			}))
			if err != nil {
				t.Fatalf("WarehouseStockList: %v", err)
			}

			return fmt.Sprintf("%d rows of %d", len(res.Msg.GetIds()), res.Msg.GetPageInfo().GetTotalItems())
		}
	}

	var someHeld, notHeld []uint64

	err := raw.Raw(`SELECT DISTINCT product_id FROM batches WHERE warehouse_id = ? ORDER BY product_id LIMIT 150`, perfPickBigWarehouse).
		Scan(&someHeld).Error
	if err != nil {
		t.Fatal(err)
	}

	err = raw.Raw(`SELECT id FROM products WHERE product_code LIKE 'PF-%' AND id NOT IN (SELECT product_id FROM batches WHERE warehouse_id = ?)
		ORDER BY id LIMIT 50`, perfPickBigWarehouse).Scan(&notHeld).Error
	if err != nil {
		t.Fatal(err)
	}

	byIds := func(team uint64, ids []uint64) func() string {
		return func() string {
			res, byIdsErr := products.ProductTagsByIds(ctx, connect.NewRequest(&productv1.ProductTagsByIdsRequest{TeamId: team, ProductIds: ids}))
			if byIdsErr != nil {
				t.Fatalf("ProductTagsByIds: %v", byIdsErr)
			}

			return fmt.Sprintf("%d of %d ids seen", len(res.Msg.GetItems()), len(ids))
		}
	}

	for _, wh := range []struct {
		id   uint64
		held string
	}{{perfPickBigWarehouse, "10 000"}, {perfPickWarehouse, "5 000"}} {
		timed(fmt.Sprintf("WarehouseStockList held %s · no tag", wh.held), list(wh.id, nil))
		timed(fmt.Sprintf("WarehouseStockList held %s · rare", wh.held), list(wh.id, []uint64{rare}))
		timed(fmt.Sprintf("WarehouseStockList held %s · common", wh.held), list(wh.id, []uint64{common}))
		timed(fmt.Sprintf("WarehouseStockList held %s · rare or common", wh.held), list(wh.id, []uint64{rare, common}))
	}

	ids := append(append([]uint64{}, someHeld...), notHeld...)

	timed("ProductTagsByIds as the 10 000-held warehouse · 200 ids (150 held)", byIds(perfPickBigWarehouse, ids))
	timed("ProductTagsByIds as a warehouse holding none · 200 ids", byIds(9_100_099, ids))

	// HeldAmong's plan — the one read the who-sees check adds, over the batch ledger.
	probe.Reset()
	byIds(perfPickBigWarehouse, ids)()

	for _, q := range probe.Queries() {
		t.Logf("plan:\n%s", san_perf.Explain(t, raw, q.SQL))
	}

	// The list's search among the 10 000 held ids, with and without a tag: its real execution time on the server, apart
	// from carrying the big id array over this host's loopback (the control below).
	for _, tags := range [][]uint64{nil, {rare}, {common}} {
		probe.Reset()
		list(perfPickBigWarehouse, tags)()

		for _, q := range probe.Queries() {
			if strings.Contains(q.SQL, "total_matches") {
				plan := san_perf.Explain(t, raw, q.SQL)

				for _, line := range strings.Split(plan, "\n") {
					if strings.Contains(line, "Execution Time") || strings.Contains(line, "Planning Time") {
						t.Logf("SearchAmong among 10 000 held · tags %v · %s", tags, strings.TrimSpace(line))
					}
				}
			}
		}
	}

	var held []uint64

	err = raw.Raw(`SELECT DISTINCT product_id FROM batches WHERE warehouse_id = ? ORDER BY product_id`, perfPickBigWarehouse).Scan(&held).Error
	if err != nil {
		t.Fatal(err)
	}

	parts := make([]string, 0, len(held))
	for _, id := range held {
		parts = append(parts, strconv.FormatUint(id, 10))
	}

	param := "{" + strings.Join(parts, ",") + "}"

	for _, c := range []struct {
		name string
		sql  string
		args []any
	}{
		{"the id array alone", `SELECT length(?)`, []any{param}},
		{"the id array and a tag array", `SELECT length(?) + length(?)`, []any{param, "{" + strconv.FormatUint(rare, 10) + "}"}},
	} {
		timed(fmt.Sprintf("control · %s (%d bytes)", c.name, len(param)), func() string {
			var n int

			scanErr := db.Raw(c.sql, c.args...).Scan(&n).Error
			if scanErr != nil {
				t.Fatal(scanErr)
			}

			return strconv.Itoa(n)
		})
	}
}
