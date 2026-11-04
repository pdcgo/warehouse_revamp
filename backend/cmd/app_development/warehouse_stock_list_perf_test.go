//go:build perfaudit

// Performance audit for WarehouseStockList (the audit-rpc-performance skill) — the Stock screen
// (the-stock-screen-lists-what-the-warehouse-has-held), measured through the REAL wiring: inventory's held-ids read,
// product_service's SearchAmong through the composition root's reader, then the placement ledger's on-hand for the page,
// on one probed database. The catalogue and the batch ledger are WarehouseProductSearch's seed (perfPickerVolume); the
// placement ledger is added here.
//
//	go test -tags perfaudit -p 1 -run TestPerf_WarehouseStockList -v ./backend/cmd/app_development/
package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// perfStockShelves adds the placement ledger the on-hand reads: 40 racks in each of the two measured warehouses, and
// every product held there on two of them — 10 000 rows at W1 (5 000 held), 20 000 at W2 (10 000 held). One in four
// of W1's products is on its racks at 0, as a product emptied by orders is.
func perfStockShelves(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO placements (warehouse_id, code, name)
		 SELECT w, 'perf-r-' || w || '-' || g, 'Rak'
		 FROM generate_series(1, 40) g CROSS JOIN (VALUES (9100001), (9100002)) AS ws(w)`,

		`INSERT INTO product_placements (team_id, warehouse_id, product_id, placement_id, stock_count)
		 SELECT h.team_id, h.warehouse_id, h.product_id, r.id, CASE WHEN h.product_id % 4 = 0 AND h.warehouse_id = 9100001 THEN 0 ELSE 7 END
		 FROM (SELECT DISTINCT warehouse_id, team_id, product_id FROM batches WHERE warehouse_id IN (9100001, 9100002)) h
		 CROSS JOIN LATERAL (
		   SELECT id FROM placements p
		   WHERE p.warehouse_id = h.warehouse_id AND p.code LIKE 'perf-r-%'
		   ORDER BY (p.id + h.product_id) % 40
		   LIMIT 2
		 ) r`,
	}

	for _, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("shelf seed: %v\n%s", err, statement)
		}
	}

	for _, table := range []string{"placements", "product_placements"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}
}

func TestPerf_WarehouseStockList(t *testing.T) {
	raw := san_testdb.DB(t)
	perfPickerVolume(t, raw)
	perfStockShelves(t, raw)

	db, probe := san_perf.Wrap(raw)
	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, NewInventoryProductReader(product_v1.NewService(db, nil, nil)), nil)
	ctx := context.Background()

	list := func(warehouse uint64, q string, page, limit uint32) *inventoryv1.WarehouseStockListResponse {
		res, err := inventory.WarehouseStockList(ctx, connect.NewRequest(&inventoryv1.WarehouseStockListRequest{
			WarehouseId: warehouse,
			Filter:      &inventoryv1.WarehouseStockListFilter{Q: q},
			Page:        &commonv1.CommonPagination{Page: page, Limit: limit},
		}))
		if err != nil {
			t.Fatalf("list %q: %v", q, err)
		}

		return res.Msg
	}

	cases := []struct {
		warehouse uint64
		held      string
		q         string
		page      uint32
		limit     uint32
	}{
		{perfPickBigWarehouse, "10 000", "", 1, 20},
		{perfPickBigWarehouse, "10 000", "", 1, 50},
		{perfPickBigWarehouse, "10 000", "", 200, 50},
		{perfPickBigWarehouse, "10 000", "kaos", 1, 20},
		{perfPickBigWarehouse, "10 000", "kaos", 1, 50},
		{perfPickBigWarehouse, "10 000", "PF-123", 1, 20},
		{perfPickWarehouse, "5 000", "", 1, 20},
		{perfPickWarehouse, "5 000", "kaos", 1, 50},
	}

	for _, c := range cases {
		name := fmt.Sprintf("held %s · q=%q · page %d of %d", c.held, c.q, c.page, c.limit)

		// Warm-up: schema reflection and the pool are not the RPC's cost.
		first := list(c.warehouse, c.q, c.page, c.limit)

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				list(c.warehouse, c.q, c.page, c.limit)
			})

			walls = append(walls, wall)
			t.Logf("%s: wall=%v db=%v go=%v queries=%d", name, wall, dbTime, wall-dbTime, probe.Count())
		}

		t.Logf("%s: median wall %v — %d rows on the page of %d", name, san_perf.Median(walls),
			len(first.GetIds()), first.GetPageInfo().GetTotalItems())
		probe.Report(t, name)
	}

	// The plans, at the 10 000-held warehouse with nothing typed — the screen's first paint.
	probe.Reset()
	list(perfPickBigWarehouse, "", 1, 20)

	for _, q := range probe.Queries() {
		san_perf.Explain(t, raw, q.SQL)
	}

	// THE CONTROL: the held-id list bound to a query that does nothing with it — the cost of carrying it to Postgres on
	// this host's loopback, not of listing it (WarehouseProductSearch.md, the-id-list-stalls-on-this-loopback).
	for _, warehouse := range []uint64{perfPickWarehouse, perfPickBigWarehouse} {
		var ids []uint64

		err := raw.Raw(`SELECT DISTINCT product_id FROM batches WHERE warehouse_id = ?`, warehouse).Scan(&ids).Error
		if err != nil {
			t.Fatalf("held ids: %v", err)
		}

		payload := fmt.Sprint(ids)
		walls := make([]time.Duration, 0, 5)

		for range 5 {
			var n int64

			start := time.Now()

			err = raw.Raw(`SELECT length(?)`, payload).Scan(&n).Error
			if err != nil {
				t.Fatalf("control: %v", err)
			}

			walls = append(walls, time.Since(start))
		}

		t.Logf("control — %d ids (%d bytes) bound to SELECT length($1): median %v", len(ids), len(payload), san_perf.Median(walls))
	}
}
