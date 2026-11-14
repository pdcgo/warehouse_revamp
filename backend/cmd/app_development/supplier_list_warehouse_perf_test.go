//go:build perfaudit

// Performance audit for SupplierList's Gudang filter (the-warehouse-filters-before-the-team, the audit-rpc-performance
// skill), measured through the REAL wiring: supplier_service's SupplierList asks inventory's batches through the
// composition root's supplierGoodsReader (inventory_v1.SupplierIDsAtWarehouse), on one probed database.
//
// Volume: 2 000 suppliers kept by 10 selling teams (200 each); 100 000 batches over 8 warehouses — the big one holds 30 %
// (≈ 30 000 batches, every supplier's goods), each other ≈ 10 000 batches from ≈ 600 suppliers; two in five batches
// emptied, a third from nobody; 85 % minted by a restock, 10 % by a transfer, 5 % by a return; 300 000 `order` rows on
// batch_logs.
//
//	go test -tags perfaudit -p 1 -run TestPerf_SupplierListWarehouse -v ./backend/cmd/app_development/
package main

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

const (
	perfSwTeam      uint64 = 9_530_001
	perfSwBig       uint64 = 9_531_001
	perfSwSmall     uint64 = 9_531_004
	perfSwNoGoods   uint64 = 9_531_099
	perfSwSuppliers        = 2_000
)

func perfSwVolume(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO suppliers (team_id, name, contact, address, description, created_at, updated_at)
		 SELECT 9530001 + g % 10, 'PSW ' || (ARRAY['Kain','Benang','Kancing','Resleting','Batik'])[1 + g % 5] || ' ' || g,
		        '08' || lpad(g::text, 10, '0'), 'Jl. Perf ' || g, 'seeded for the perf audit', NOW(), NOW()
		 FROM generate_series(1, 2000) g`,

		// 25 000 receipts × 4 lines. Warehouse offset 0 (the big one) for g % 10 < 3, else 3–9.
		`WITH s AS (SELECT array_agg(id ORDER BY id) AS ids FROM suppliers WHERE name LIKE 'PSW %'),
		 t AS (
		   INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, created_at, updated_at)
		   SELECT 9531001 + CASE WHEN g % 10 < 3 THEN 0 ELSE g % 10 END, 9530001 + g % 10,
		          CASE WHEN abs(hashint4(g)) % 20 < 17 THEN 'restock' WHEN abs(hashint4(g)) % 20 < 19 THEN 'transfer_in' ELSE 'return' END,
		          NOW() - g * INTERVAL '5 minutes', NOW()
		   FROM generate_series(1, 25000) g
		   RETURNING id, warehouse_id, team_id, created_at
		 )
		 INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                      init_stock_count, init_stock_valuation, supplier_id, created_at, updated_at)
		 SELECT t.warehouse_id, t.team_id, 1000 + ((t.id * 4 + n) % 5000), t.id, 10000,
		        CASE WHEN abs(hashint8(t.id * 4 + n + 7)) % 5 < 2 THEN 0 ELSE 1 + (t.id + n) % 12 END,
		        CASE WHEN abs(hashint8(t.id * 4 + n + 7)) % 5 < 2 THEN 0 ELSE (1 + (t.id + n) % 12) * 10000 END,
		        20, 200000,
		        CASE WHEN abs(hashint8(t.id * 4 + n + 3)) % 3 = 0 THEN 0
		             WHEN t.warehouse_id = 9531001 THEN s.ids[1 + abs(hashint8(t.id * 4 + n)) % 2000]
		             ELSE s.ids[1 + ((t.warehouse_id - 9531001) * 250 + abs(hashint8(t.id * 4 + n)) % 600) % 2000] END,
		        t.created_at, NOW()
		 FROM t CROSS JOIN s CROSS JOIN generate_series(1, 4) n`,

		`WITH bounds AS (SELECT MIN(id) AS lo, MAX(id) - MIN(id) AS span FROM batches WHERE team_id BETWEEN 9530001 AND 9530010),
		 t AS (
		   INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, is_rollback, created_at, updated_at)
		   SELECT 9531001, 9530001, 'order', g % 50 = 0, NOW() - g * INTERVAL '1 minute', NOW()
		   FROM generate_series(1, 150000) g
		   RETURNING id, created_at
		 )
		 INSERT INTO batch_logs (warehouse_id, team_id, batch_id, transaction_id, change_type, change_count, change_valuation,
		                         stock_count_after, stock_valuation_after, price_unit_after, description, actor_id, created_at)
		 SELECT 9531001, 9530001, bounds.lo + ((t.id * 7919 + n * 104729) % bounds.span), t.id, 'order', -1, -10000,
		        1, 10000, 10000, '', 1, t.created_at
		 FROM t CROSS JOIN bounds CROSS JOIN generate_series(1, 2) n`,
	}

	for _, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("supplier warehouse seed: %v\n%s", err, statement)
		}
	}

	for _, table := range []string{"suppliers", "inventory_transactions", "batches", "batch_logs"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}
}

// perfSwStep names a statement by what it does, for the summary table.
func perfSwStep(sql string) string {
	switch {
	case strings.Contains(sql, "SELECT DISTINCT b.supplier_id"):
		return "at-warehouse"
	case strings.Contains(sql, "per_order") || strings.Contains(sql, "HAVING"):
		return "band"
	case strings.Contains(sql, "count(*)"):
		return "count"
	case strings.Contains(sql, "FROM \"supplier_channels\""):
		return "stores"
	case strings.Contains(sql, "FROM \"suppliers\""):
		return "page"
	}

	return "other"
}

type perfSwCase struct {
	name string
	run  func() (string, error)
}

func perfSwMeasure(t *testing.T, probe *san_perf.Probe, summary *strings.Builder, c perfSwCase) {
	t.Helper()

	shape, err := c.run() // warm-up: schema reflection and the pool are not the read's cost
	if err != nil {
		t.Fatalf("%s: %v", c.name, err)
	}

	walls := make([]time.Duration, 0, 5)
	steps := map[int][]time.Duration{}
	labels := map[int]string{}

	for range 5 {
		probe.Reset()

		wall, _ := probe.Measure(func() {
			_, err = c.run()
		})
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		walls = append(walls, wall)

		for i, q := range probe.Queries() {
			steps[i] = append(steps[i], q.Duration)
			labels[i] = perfSwStep(q.SQL)
		}
	}

	keys := make([]int, 0, len(steps))
	for i := range steps {
		keys = append(keys, i)
	}

	sort.Ints(keys)

	parts := make([]string, 0, len(keys))
	for _, i := range keys {
		parts = append(parts, fmt.Sprintf("%s %.1f", labels[i], float64(san_perf.Median(steps[i]).Microseconds())/1000))
	}

	fmt.Fprintf(summary, "| %s | %s | %d | %s | %.1f ms |\n", c.name, shape, len(keys), strings.Join(parts, " · "),
		float64(san_perf.Median(walls).Microseconds())/1000)
}

func TestPerf_SupplierListWarehouse(t *testing.T) {
	raw := san_testdb.DB(t)

	// A run is only worth quoting on clean tables: a killed run's seed sits as dead rows (revamp-build-passes).
	for _, table := range []string{"suppliers", "batches", "batch_logs"} {
		var size int64

		err := raw.Raw(`SELECT pg_relation_size(?::regclass)`, table).Scan(&size).Error
		if err != nil {
			t.Fatalf("size of %s: %v", table, err)
		}

		t.Logf("before the seed: %s = %d bytes on disk", table, size)
	}

	perfSwVolume(t, raw)

	db, probe := san_perf.Wrap(raw)
	ctx := context.Background()
	reader := NewSupplierGoodsReader(inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil), db)
	svc := supplier_v1.NewService(db, nil, nil, reader, nil)

	at := func(warehouse uint64) func() (string, error) {
		return func() (string, error) {
			ids, err := inventory_v1.SupplierIDsAtWarehouse(ctx, db, warehouse)

			return fmt.Sprintf("%d ids", len(ids)), err
		}
	}

	own := supplierv1.SupplierListScope_SUPPLIER_LIST_SCOPE_OWN
	every := supplierv1.SupplierListScope_SUPPLIER_LIST_SCOPE_EVERY_TEAM
	byName := &supplierv1.SupplierListFilterSort{
		SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_ASC,
		S:        &supplierv1.SupplierListFilterSort_Supplier{Supplier: supplierv1.SupplierRowSort_SUPPLIER_ROW_SORT_NAME},
	}

	list := func(filter *supplierv1.SupplierListFilter, sort *supplierv1.SupplierListFilterSort, pageNo uint32) func() (string, error) {
		return func() (string, error) {
			res, err := svc.SupplierList(ctx, connect.NewRequest(&supplierv1.SupplierListRequest{
				TeamId: perfSwTeam,
				Filter: filter,
				Sort:   sort,
				DataRequest: []supplierv1.SupplierListDataType{
					supplierv1.SupplierListDataType_SUPPLIER_LIST_DATA_TYPE_SUPPLIER,
					supplierv1.SupplierListDataType_SUPPLIER_LIST_DATA_TYPE_CHANNELS,
				},
				Page: &commonv1.CommonPagination{Page: pageNo, Limit: 20},
			}))
			if err != nil {
				return "", err
			}

			return fmt.Sprintf("%d of %d", len(res.Msg.GetIds()), res.Msg.GetPageInfo().GetTotalItems()), nil
		}
	}

	cases := []perfSwCase{
		{"seam: the big warehouse (≈30 000 batches)", at(perfSwBig)},
		{"seam: a small warehouse (≈10 000 batches)", at(perfSwSmall)},
		{"seam: a warehouse with no goods", at(perfSwNoGoods)},
		{"list: own, no warehouse (today)", list(&supplierv1.SupplierListFilter{Scope: own}, nil, 1)},
		{"list: own, big warehouse", list(&supplierv1.SupplierListFilter{Scope: own, WarehouseId: perfSwBig}, nil, 1)},
		{"list: own, small warehouse, by name, page 5", list(&supplierv1.SupplierListFilter{Scope: own, WarehouseId: perfSwSmall}, byName, 5)},
		{"list: own, small warehouse + q=kain", list(&supplierv1.SupplierListFilter{Scope: own, WarehouseId: perfSwSmall, Q: "kain"}, nil, 1)},
		{"list: Discover, no warehouse (today)", list(&supplierv1.SupplierListFilter{Scope: every}, nil, 1)},
		{"list: Discover, big warehouse", list(&supplierv1.SupplierListFilter{Scope: every, WarehouseId: perfSwBig}, nil, 1)},
		{"list: Discover, big warehouse, by name, page 50", list(&supplierv1.SupplierListFilter{Scope: every, WarehouseId: perfSwBig}, byName, 50)},
		{"list: Discover, small warehouse + team", list(&supplierv1.SupplierListFilter{Scope: every, WarehouseId: perfSwSmall, OwnerTeamId: perfSwTeam + 3}, nil, 1)},
		{"list: Discover, big warehouse + Siap < 50", list(&supplierv1.SupplierListFilter{Scope: every, WarehouseId: perfSwBig,
			Ready: &supplierv1.SupplierFigureBand{Min: 0, Max: 50}}, nil, 1)},
		{"list: Discover, big warehouse + Terjual 500–1.000", list(&supplierv1.SupplierListFilter{Scope: every, WarehouseId: perfSwBig,
			Sold: &supplierv1.SupplierFigureBand{Min: 500, Max: 1_000}}, nil, 1)},
		{"list: Discover, no-goods warehouse + Terjual 500–1.000", list(&supplierv1.SupplierListFilter{Scope: every, WarehouseId: perfSwNoGoods,
			Sold: &supplierv1.SupplierFigureBand{Min: 500, Max: 1_000}}, nil, 1)},
	}

	var summary strings.Builder

	summary.WriteString("\n| case | answer | queries | step medians, ms | wall median |\n|---|---|---|---|---|\n")

	for _, c := range cases {
		perfSwMeasure(t, probe, &summary, c)
	}

	t.Log(summary.String())

	// The seam's plan, and the narrowed count and page of Discover at the big warehouse.
	for _, c := range []perfSwCase{cases[0], cases[1], cases[8]} {
		probe.Reset()

		_, err := c.run()
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		for _, q := range probe.Queries() {
			san_perf.Explain(t, raw, q.SQL)
		}
	}

	// THE CONTROL: the id array Discover at the big warehouse binds, bound to a query that does nothing with it — this
	// host's loopback cost of a big parameter, not the read's.
	probe.Reset()

	_, err := cases[8].run()
	if err != nil {
		t.Fatalf("control: %v", err)
	}

	for _, q := range probe.Queries() {
		if !strings.Contains(q.SQL, "ANY(CAST('{") {
			continue
		}

		payload := q.SQL[strings.Index(q.SQL, "'{"):]
		payload = payload[:strings.Index(payload, "}'")+2]

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

		t.Logf("control — a %d-byte id array bound to SELECT length($1): median %v", len(payload), san_perf.Median(walls))

		break
	}

	// THE SHAPES, PROBED — the same set asked three ways, EXPLAINed on the big, a small and an empty warehouse:
	//   or-exists   the restock test as EXISTS — the planner HASHES every restock transaction of every warehouse;
	//   scalar      the restock test as a scalar subquery — always a per-row primary-key lookup, run only for a batch
	//               the shelf test did not already keep;
	//   per-supplier one index probe per supplier, stopping at its first batch that counts.
	shapes := map[string]string{
		"or-exists": `SELECT DISTINCT b.supplier_id FROM batches b WHERE b.warehouse_id = %[1]d AND b.supplier_id > 0 AND (b.stock_count > 0
			OR EXISTS (SELECT 1 FROM inventory_transactions t WHERE t.id = b.transaction_id AND t.tx_type = 'restock')
			OR EXISTS (SELECT 1 FROM batch_logs l WHERE l.batch_id = b.id AND l.change_type = 'order')) ORDER BY b.supplier_id`,
		"scalar": `SELECT DISTINCT b.supplier_id FROM batches b WHERE b.warehouse_id = %[1]d AND b.supplier_id > 0 AND (b.stock_count > 0
			OR (SELECT t.tx_type FROM inventory_transactions t WHERE t.id = b.transaction_id) = 'restock'
			OR EXISTS (SELECT 1 FROM batch_logs l WHERE l.batch_id = b.id AND l.change_type = 'order')) ORDER BY b.supplier_id`,
		"per-supplier": `SELECT s.supplier_id FROM (SELECT DISTINCT supplier_id FROM batches WHERE warehouse_id = %[1]d AND supplier_id > 0) s
			WHERE EXISTS (SELECT 1 FROM batches b WHERE b.warehouse_id = %[1]d AND b.supplier_id = s.supplier_id AND (b.stock_count > 0
			OR (SELECT t.tx_type FROM inventory_transactions t WHERE t.id = b.transaction_id) = 'restock'
			OR EXISTS (SELECT 1 FROM batch_logs l WHERE l.batch_id = b.id AND l.change_type = 'order'))) ORDER BY s.supplier_id`,
	}

	shapeRun := func(label string) {
		for _, name := range []string{"or-exists", "scalar", "per-supplier"} {
			for _, w := range []uint64{perfSwBig, perfSwSmall, perfSwNoGoods} {
				sql := fmt.Sprintf(shapes[name], w)

				var n int

				walls := make([]time.Duration, 0, 5)

				for range 6 {
					var ids []uint64

					start := time.Now()

					err = raw.Raw(sql).Scan(&ids).Error
					if err != nil {
						t.Fatalf("%s %s: %v", label, name, err)
					}

					walls = append(walls, time.Since(start))
					n = len(ids)
				}

				t.Logf("%s · %s · warehouse %d: %d ids, median %v", label, name, w, n, san_perf.Median(walls[1:]))
			}
		}

		san_perf.Explain(t, raw, fmt.Sprintf(shapes["scalar"], perfSwBig))
		san_perf.Explain(t, raw, fmt.Sprintf(shapes["per-supplier"], perfSwBig))
	}

	shapeRun("no new index")

	// THE INDEX PROBE (a-pure-index-is-added-without-asking only on a measured gain): a warehouse-leading partial index
	// carrying what the predicate reads, created inside this test's transaction — never a migration from here.
	for _, ddl := range []string{
		"CREATE INDEX perf_batches_warehouse_supplier_idx ON batches (warehouse_id, supplier_id) INCLUDE (stock_count, transaction_id) WHERE supplier_id > 0",
		"ANALYZE batches",
	} {
		err = raw.Exec(ddl).Error
		if err != nil {
			t.Fatalf("%s: %v", ddl, err)
		}
	}

	var indexed strings.Builder

	indexed.WriteString("\n| WITH the probe index | answer | queries | step medians, ms | wall median |\n|---|---|---|---|---|\n")

	for _, c := range []perfSwCase{cases[0], cases[1], cases[8]} {
		perfSwMeasure(t, probe, &indexed, c)
	}

	t.Log(indexed.String())

	shapeRun("with the probe index")

	probe.Reset()

	_, err = cases[0].run()
	if err != nil {
		t.Fatalf("indexed plan: %v", err)
	}

	for _, q := range probe.Queries() {
		san_perf.Explain(t, raw, q.SQL)
	}
}
