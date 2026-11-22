//go:build perfaudit

// THE PRODUK TAB'S BATCH LOOKUP, with and without the pure index 00063 adds — `batches_supplier_product_idx ON batches
// (supplier_id, supplier_channel_id, product_id, warehouse_id)` (a-pure-index-is-added-without-asking) — on ONE seed in
// one process: after, before, before, after (the index dropped and re-created inside the test transaction), then — measured
// only, for the owner — 00063 with batches_supplier_idx dropped.
//
// Volume: backlog #116's probe (SupplierGoods.md's 200 000 batches, supplier 7 holding a tenth of them, 3 000 others; 500 000
// orders × 2 batch rows, each order's rows on batches in its OWN warehouse, the one in fifty rolled back really flipped).
// Measured: SupplierStoreProductGoods (the Produk tab's figures) for 20 and 200 pairs of the big supplier, no chip and
// under its busiest warehouse's chip, under the custom and the generic plan (pgx prepares every statement; Postgres goes
// generic after five runs) — plus every other read that walks batches by supplier (the chip's pair and store sets, the
// supplier list's Gudang set, SupplierGoods' whole answer), to show the index steals none of their plans.
//
//	go test -tags perfaudit -p 1 -run TestPerf_SupplierStoreProductGoods -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

const perfSpgIndex = `batches_supplier_product_idx`

// perfSpgBackground is p116Background's volume less its hot supplier 8 (supplier_goods_totals_probe_perf_test.go):
// SupplierGoods.md's batches, and each order's two rows on batches of its own warehouse (a take draws in one), the
// one-in-fifty rollbacks flipped an hour later.
func perfSpgBackground(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	for _, sql := range []string{
		`WITH t AS (
		   INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, created_at, updated_at)
		   SELECT 5 + (g % 20), 100 + (g % 30), 'restock', NOW() - g * INTERVAL '10 minutes', NOW()
		   FROM generate_series(1, 50000) g
		   RETURNING id, warehouse_id, team_id, created_at
		 )
		 INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                      init_stock_count, init_stock_valuation, supplier_id, supplier_channel_id, created_at, updated_at)
		 SELECT t.warehouse_id, t.team_id, 1000 + ((t.id * 4 + n) % 5000), t.id, 10000, (t.id + n) % 12, ((t.id + n) % 12) * 10000,
		        20, 200000,
		        CASE WHEN t.id % 10 = 0 THEN 7 WHEN t.id % 3 = 0 THEN 0 ELSE 100 + t.id % 3000 END,
		        CASE WHEN t.id % 3 = 0 AND t.id % 10 <> 0 THEN 0 ELSE 1 + (t.id % 4) END,
		        t.created_at, NOW()
		 FROM t CROSS JOIN generate_series(1, 4) n`,
		`CREATE TEMP TABLE s118_bw ON COMMIT DROP AS
		 SELECT id AS batch_id, warehouse_id, team_id, ROW_NUMBER() OVER (PARTITION BY warehouse_id ORDER BY id) - 1 AS rn
		 FROM batches`,
		`CREATE INDEX ON s118_bw (warehouse_id, rn)`,
		`CREATE TEMP TABLE s118_bn ON COMMIT DROP AS SELECT warehouse_id, COUNT(*) AS n FROM s118_bw GROUP BY 1`,
		`WITH t AS (
		   INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, is_rollback, created_at, updated_at)
		   SELECT 5 + (g % 20), 100 + (g % 30), 'order', g % 50 = 0, NOW() - g * INTERVAL '1 minute', NOW()
		   FROM generate_series(1, 500000) g
		   RETURNING id, warehouse_id, created_at, is_rollback
		 ), picks AS (
		   SELECT t.id, t.warehouse_id, t.created_at, t.is_rollback, bw.batch_id, bw.team_id
		   FROM t
		   JOIN s118_bn c ON c.warehouse_id = t.warehouse_id
		   CROSS JOIN generate_series(1, 2) AS s(pick)
		   JOIN s118_bw bw ON bw.warehouse_id = t.warehouse_id
		    AND bw.rn = (hashtext(t.id::text || '.' || s.pick::text)::bigint & 2147483647) % c.n
		 )
		 INSERT INTO batch_logs (warehouse_id, team_id, batch_id, transaction_id, change_type, change_count, change_valuation,
		                         stock_count_after, stock_valuation_after, price_unit_after, description, actor_id, created_at)
		 SELECT warehouse_id, team_id, batch_id, id, 'order', -1, -10000, 1, 10000, 10000, '', 1, created_at FROM picks
		 UNION ALL
		 SELECT warehouse_id, team_id, batch_id, id, 'order', 1, 10000, 1, 10000, 10000, 'rollback', 1,
		        created_at + INTERVAL '1 hour'
		 FROM picks WHERE is_rollback`,
		"ANALYZE batches",
		"ANALYZE batch_logs",
		"ANALYZE inventory_transactions",
	} {
		err := quiet.Exec(sql).Error
		if err != nil {
			t.Fatalf("produk tab background: %v\n%s", err, sql)
		}
	}
}

// perfSpgCapture records the parameterised SQL and the arguments of the last statement holding each marker in `also` —
// a GORM Row callback (Raw(...).Scan and a chain's Scan both run the Row callbacks), so a plan can be EXPLAINed with the
// very arguments the read bound, under the generic plan too.
type perfSpgCapture struct {
	marker string
	sql    string
	vars   []any
	all    map[string]perfSpgCapture // the captured statements, by marker
	also   []string
}

func perfSpgCapturing(t *testing.T, db *gorm.DB) *perfSpgCapture {
	t.Helper()

	c := &perfSpgCapture{all: map[string]perfSpgCapture{}}
	name := "s118:capture"

	err := db.Callback().Row().After("gorm:row").Register(name, func(tx *gorm.DB) {
		sql := tx.Statement.SQL.String()

		for _, m := range c.also {
			if strings.Contains(sql, m) {
				c.all[m] = perfSpgCapture{marker: m, sql: sql, vars: append([]any(nil), tx.Statement.Vars...)}
			}
		}
	})
	if err != nil {
		t.Fatalf("register the capture: %v", err)
	}

	t.Cleanup(func() {
		_ = db.Callback().Row().Remove(name)
	})

	return c
}

// perfSpgLiteral writes one bound argument as an SQL literal for EXECUTE.
func perfSpgLiteral(v any) string {
	switch x := v.(type) {
	case uint64, uint32, uint, int64, int32, int:
		return fmt.Sprintf("%d", x)
	case bool:
		return fmt.Sprintf("%t", x)
	case time.Time:
		return "'" + x.Format(time.RFC3339Nano) + "'"
	default:
		return "'" + strings.ReplaceAll(fmt.Sprint(x), "'", "''") + "'"
	}
}

// perfSpgExplain PREPAREs the captured statement and runs EXPLAIN (ANALYZE, BUFFERS) EXECUTE with its own arguments on the
// test transaction — through the plan cache, so plan_cache_mode decides custom or generic (an EXPLAIN of the statement with
// bound parameters would always plan it custom) — and logs the plan's scan lines and its execution time.
func perfSpgExplain(t *testing.T, db *gorm.DB, c *perfSpgCapture, label string) {
	t.Helper()

	if c.sql == "" {
		t.Fatalf("%s: nothing captured for %q", label, c.marker)
	}

	ctx := context.Background()
	pool := db.Statement.ConnPool

	_, err := pool.ExecContext(ctx, "PREPARE s118_explain AS "+c.sql)
	if err != nil {
		t.Fatalf("%s: prepare: %v", label, err)
	}

	defer func() {
		_, _ = pool.ExecContext(ctx, "DEALLOCATE s118_explain")
	}()

	execute := "EXECUTE s118_explain"

	if len(c.vars) > 0 {
		literals := make([]string, 0, len(c.vars))
		for _, v := range c.vars {
			literals = append(literals, perfSpgLiteral(v))
		}

		execute += "(" + strings.Join(literals, ", ") + ")"
	}

	rows, err := pool.QueryContext(ctx, "EXPLAIN (ANALYZE, BUFFERS) "+execute)
	if err != nil {
		t.Fatalf("%s: explain: %v", label, err)
	}
	defer func() { _ = rows.Close() }()

	var keep []string

	for rows.Next() {
		var line string

		err = rows.Scan(&line)
		if err != nil {
			t.Fatalf("%s: explain row: %v", label, err)
		}

		if strings.Contains(line, "Scan") || strings.Contains(line, "Index Cond") || strings.Contains(line, "Execution Time") ||
			strings.Contains(line, "Rows Removed") {
			keep = append(keep, line)
		}
	}

	t.Logf("S118 PLAN %s\n%s", label, strings.Join(keep, "\n"))
}

func perfSpgTime(t *testing.T, label string, runs int, fn func() error) time.Duration {
	t.Helper()

	err := fn() // warm-up: schema reflection, the prepared statement, the first touch of the pages
	if err != nil {
		t.Fatalf("%s warm-up: %v", label, err)
	}

	walls := make([]time.Duration, 0, runs)

	for range runs {
		start := time.Now()

		err = fn()
		if err != nil {
			t.Fatalf("%s: %v", label, err)
		}

		walls = append(walls, time.Since(start))
	}

	slices.Sort(walls)

	t.Logf("S118 TIME %s median=%v min=%v max=%v", label, walls[len(walls)/2], walls[0], walls[len(walls)-1])

	return walls[len(walls)/2]
}

func perfSpgVacuum(t *testing.T, tables ...string) {
	t.Helper()

	pool := san_testdb.Pool(t).Session(&gorm.Session{Logger: logger.Discard})

	for _, table := range tables {
		err := pool.Exec("VACUUM ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("vacuum %s: %v", table, err)
		}
	}
}

func TestPerf_SupplierStoreProductGoods(t *testing.T) {
	// A run is only worth quoting on clean tables: every earlier probe's seed is rolled back and sits as dead rows.
	perfSpgVacuum(t, "batches", "batch_logs", "inventory_transactions")

	db := san_testdb.DB(t)
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})
	ctx := context.Background()

	var present bool

	err := quiet.Raw(`SELECT to_regclass(?) IS NOT NULL`, perfSpgIndex).Scan(&present).Error
	if err != nil || !present {
		t.Fatalf("the index %s is not there (migration 00063 not applied?): %v", perfSpgIndex, err)
	}

	start := time.Now()

	perfSpgBackground(t, db)
	t.Logf("S118 seed: %v", time.Since(start))

	var bigHouse uint64

	err = quiet.Raw(`SELECT warehouse_id FROM batches WHERE supplier_id = ? GROUP BY 1 ORDER BY COUNT(*) DESC, 1 LIMIT 1`,
		perfBigSupplier).Scan(&bigHouse).Error
	if err != nil {
		t.Fatal(err)
	}

	var spread struct {
		Batches, Big, BigHere, Pairs int64
	}

	err = quiet.Raw(`SELECT COUNT(*) AS batches,
		       COUNT(*) FILTER (WHERE supplier_id = ?) AS big,
		       COUNT(*) FILTER (WHERE supplier_id = ? AND warehouse_id = ?) AS big_here,
		       (SELECT COUNT(*) FROM (SELECT DISTINCT supplier_channel_id, product_id FROM batches WHERE supplier_id = ?) p) AS pairs
		FROM batches`, perfBigSupplier, perfBigSupplier, bigHouse, perfBigSupplier).Scan(&spread).Error
	if err != nil {
		t.Fatal(err)
	}

	t.Logf("S118 volume: %d batches; the big supplier %d (%d at its busiest warehouse %d), %d (store, product) pairs",
		spread.Batches, spread.Big, spread.BigHere, bigHouse, spread.Pairs)

	pairsAt := func(warehouse uint64, limit int) []inventory_v1.StoreProduct {
		var pairs []inventory_v1.StoreProduct

		err := quiet.Raw(`SELECT DISTINCT supplier_channel_id AS store_id, product_id FROM batches
			WHERE supplier_id = ? AND (? = 0 OR warehouse_id = ?)
			ORDER BY 1, 2 LIMIT ?`, perfBigSupplier, warehouse, warehouse, limit).Scan(&pairs).Error
		if err != nil {
			t.Fatalf("pairs: %v", err)
		}

		return pairs
	}

	svc := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	page := make([]uint64, 0, 50)
	for i := range 50 {
		page = append(page, 101+uint64(i)*3)
	}

	goods := func(group inventoryv1.SupplierGoodsGroup, warehouse uint64, ids []uint64) func() error {
		return func() error {
			_, err := svc.SupplierGoods(ctxUser(1), connect.NewRequest(&inventoryv1.SupplierGoodsRequest{
				TeamId: 100, SupplierIds: ids, Group: group, WarehouseId: warehouse,
			}))

			return err
		}
	}

	type readCase struct {
		name   string
		marker string // the statement whose plan is logged
		modes  []string
		runs   int
		call   func() error
	}

	all := []string{"auto", "force_custom_plan", "force_generic_plan"}
	two := []string{"auto", "force_generic_plan"}

	var cases []readCase

	for _, chip := range []uint64{0, bigHouse} {
		for _, size := range []int{20, 200} {
			pairs := pairsAt(chip, size)

			cases = append(cases, readCase{
				name:   fmt.Sprintf("Produk tab figures, %d pairs of the big supplier, chip %d", len(pairs), chip),
				marker: "page_batches",
				modes:  all,
				runs:   5,
				call: func() error {
					_, err := inventory_v1.SupplierStoreProductGoods(ctx, db, perfBigSupplier, chip, pairs)

					return err
				},
			})
		}
	}

	cases = append(cases,
		readCase{"chip's Produk set (SupplierStoreProductsAtWarehouse), big supplier", "DISTINCT b.supplier_channel_id AS store_id", two, 5,
			func() error {
				_, err := inventory_v1.SupplierStoreProductsAtWarehouse(ctx, db, perfBigSupplier, bigHouse)

				return err
			}},
		readCase{"chip's Toko set (SupplierStoresAtWarehouse), big supplier", "SELECT DISTINCT b.supplier_channel_id\n", two, 5,
			func() error {
				_, err := inventory_v1.SupplierStoresAtWarehouse(ctx, db, perfBigSupplier, bigHouse)

				return err
			}},
		readCase{"Gudang set (SupplierIDsAtWarehouse)", "SELECT DISTINCT b.supplier_id", two, 5,
			func() error {
				_, err := inventory_v1.SupplierIDsAtWarehouse(ctx, db, bigHouse)

				return err
			}},
		readCase{"SupplierGoods list page of 50", "", two, 5,
			goods(inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_SUPPLIER, 0, page)},
		readCase{"SupplierGoods big supplier by store", "", two, 3,
			goods(inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE, 0, []uint64{perfBigSupplier})},
		readCase{"SupplierGoods big supplier by warehouse", "", two, 3,
			goods(inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_WAREHOUSE, 0, []uint64{perfBigSupplier})},
		readCase{"SupplierGoods big supplier by store under its chip", "", two, 3,
			goods(inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE, bigHouse, []uint64{perfBigSupplier})},
		readCase{"SupplierGoods small supplier by warehouse", "", two, 5,
			goods(inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_WAREHOUSE, 0, []uint64{101})},
	)

	capture := perfSpgCapturing(t, db)

	// The answers must not move with the index: the first phase's answers are kept and every later phase compared.
	answers := map[string]string{}

	measure := func(phase string) {
		for _, c := range cases {
			for _, mode := range c.modes {
				err := quiet.Exec("SET LOCAL plan_cache_mode = " + mode).Error
				if err != nil {
					t.Fatalf("plan mode %s: %v", mode, err)
				}

				label := fmt.Sprintf("%s [%s] %s", c.name, mode, phase)
				perfSpgTime(t, label, c.runs, c.call)

				if mode != "auto" {
					// SupplierGoods' three statements (its ready, restocks and sold) are each explained; any other read
					// its one marked statement.
					markers := []string{c.marker}
					if c.marker == "" {
						markers = []string{"SUM(b.stock_count) AS ready", "COUNT(DISTINCT b.transaction_id)", "per_order"}
					}

					capture.also = markers
					clear(capture.all)

					err = c.call()
					if err != nil {
						t.Fatal(err)
					}

					capture.also = nil

					for _, m := range markers {
						one := capture.all[m]
						perfSpgExplain(t, db, &one, label+" · "+m)
					}
				}
			}
		}

		err := quiet.Exec("SET LOCAL plan_cache_mode = auto").Error
		if err != nil {
			t.Fatal(err)
		}

		for _, chip := range []uint64{0, bigHouse} {
			pairs := pairsAt(chip, 200)

			got, err := inventory_v1.SupplierStoreProductGoods(ctx, db, perfBigSupplier, chip, pairs)
			if err != nil {
				t.Fatal(err)
			}

			key := fmt.Sprintf("produk chip %d", chip)
			text := fmt.Sprintf("%+v", got)

			if want, ok := answers[key]; ok && want != text {
				t.Fatalf("%s: the answer moved with the index (%s)", key, phase)
			}

			answers[key] = text
		}
	}

	drop := func() {
		err := quiet.Exec("DROP INDEX " + perfSpgIndex).Error
		if err != nil {
			t.Fatalf("drop the index: %v", err)
		}

		err = quiet.Exec("ANALYZE batches").Error
		if err != nil {
			t.Fatal(err)
		}
	}

	create := func() {
		start := time.Now()

		err := quiet.Exec("CREATE INDEX " + perfSpgIndex + " ON batches (supplier_id, supplier_channel_id, product_id, warehouse_id)").Error
		if err != nil {
			t.Fatalf("create the index: %v", err)
		}

		err = quiet.Exec("ANALYZE batches").Error
		if err != nil {
			t.Fatal(err)
		}

		t.Logf("S118 index built over %d batches in %v", spread.Batches, time.Since(start))
	}

	// The first reads of a fresh seed pay its first touches: warm them out of the measurement.
	for range 3 {
		for _, chip := range []uint64{0, bigHouse} {
			_, err := inventory_v1.SupplierStoreProductGoods(ctx, db, perfBigSupplier, chip, pairsAt(chip, 200))
			if err != nil {
				t.Fatal(err)
			}
		}
	}

	measure("(WITH 00063, 1)")
	drop()
	measure("(WITHOUT 00063, 1)")
	measure("(WITHOUT 00063, 2)")
	create()
	measure("(WITH 00063, 2)")

	// THE OWNER'S OPTION, measured only: 00063 kept and batches_supplier_idx DROPPED (inside the test transaction, rolled
	// back with it) — under a chip the cached generic plan then has only 00063 to pick. A dropped index is the owner's
	// call (a-pure-index-is-added-without-asking covers adding one), never applied from an audit.
	err = quiet.Exec("DROP INDEX batches_supplier_idx").Error
	if err != nil {
		t.Fatalf("drop batches_supplier_idx: %v", err)
	}

	err = quiet.Exec("ANALYZE batches").Error
	if err != nil {
		t.Fatal(err)
	}

	measure("(OPTION: 00063 without batches_supplier_idx)")

	t.Logf("S118 the Produk answers were identical with and without the index (%d pages compared per phase)", len(answers))
}

// THE WRITE COST OF 00063, COMMITTED, on ONE seed in one process: TestPerf_OrderTakeLatency_Committed's background and
// takes (200 one-line, 60 twenty-line, each its own committed transaction) plus 30 restock accepts of one line and 30 of
// twenty (TestPerf_RestockRequestAccept's, committed), in four phases — with the index, dropped, dropped, re-created.
// A take's stock_count UPDATE on batches is NOT a HOT update even without 00063 (stock_count is in the predicate of the
// partial batches_take_idx and batches_owner_product_idx), so every take already writes a new entry into every batches
// index; 00063 adds one more per batch a take moves, and one per batch an accept mints. It DROPs and CREATEs the index
// on the shared test database and DELETEs the ledger tables: run it alone (-p 1); the cleanup leaves the index in place.
func TestPerf_SupplierProductIndex_WriteCost_Committed(t *testing.T) {
	db := san_testdb.Pool(t)
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	ensure := func() {
		err := quiet.Exec("CREATE INDEX IF NOT EXISTS " + perfSpgIndex +
			" ON batches (supplier_id, supplier_channel_id, product_id, warehouse_id)").Error
		if err != nil {
			t.Fatalf("ensure the index: %v", err)
		}
	}

	clean := func() {
		// The take probe's tables, plus the first-held rows a restock accept writes.
		for _, table := range append([]string{"warehouse_products"}, takeLatencyTables...) {
			var exists bool

			quiet.Raw(`SELECT to_regclass(?) IS NOT NULL`, table).Scan(&exists)
			if !exists {
				continue
			}

			err := quiet.Exec(`DELETE FROM ` + table).Error
			if err != nil {
				t.Fatalf("clean %s: %v", table, err)
			}
		}
	}

	ensure()
	clean()
	t.Cleanup(func() {
		clean()
		ensure()
	})

	perfLedgerBackground(t, db)
	perfChangesBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20), nil, nil, nil, nil)
	racks := []uint64{newRack(t, svc, otWarehouse, "wc-a"), newRack(t, svc, otWarehouse, "wc-b"), newRack(t, svc, otWarehouse, "wc-c")}
	door := newRack(t, svc, otWarehouse, "wc-door")

	// Enough units for four phases of takes: product 1 is taken 260 times a phase.
	perfStock(t, db, otWarehouse, 20, 10, 500, racks)

	for _, table := range []string{"batches", "batch_logs", "inventory_transactions"} {
		err := quiet.Exec("VACUUM ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("vacuum %s: %v", table, err)
		}
	}

	stats := func(walls []time.Duration) string {
		sorted := slices.Clone(walls)
		slices.Sort(sorted)

		return fmt.Sprintf("n=%d p50=%v p95=%v min=%v max=%v", len(sorted), sorted[len(sorted)/2], sorted[len(sorted)*95/100],
			sorted[0], sorted[len(sorted)-1])
	}

	phase := func(label string) {
		for _, run := range []struct{ size, takes int }{{1, 200}, {20, 60}} {
			lines := make([]*inventoryv1.OrderTransactionLine, 0, run.size)
			for _, product := range perfProducts(run.size) {
				lines = append(lines, line(product, 1))
			}

			take := func(n int) {
				_, err := svc.OrderTransactionCreate(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
					TeamId: otMelati, IdempotencyKey: fmt.Sprintf("wc:%s:%d:%d", label, run.size, n), WarehouseId: otWarehouse,
					Lines: lines,
				}))
				if err != nil {
					t.Fatalf("take %s lines=%d #%d: %v", label, run.size, n, err)
				}
			}

			take(0) // warm-up

			walls := make([]time.Duration, 0, run.takes)
			for n := 1; n <= run.takes; n++ {
				start := time.Now()
				take(n)
				walls = append(walls, time.Since(start))
			}

			t.Logf("S118 WRITE %s ORDER TAKE lines=%d %s", label, run.size, stats(walls))
		}

		for _, size := range []int{1, 20} {
			items := make([]*inventoryv1.RestockRequestItem, 0, size)
			for _, product := range perfProducts(size) {
				items = append(items, &inventoryv1.RestockRequestItem{ProductId: product, ProductCode: "PERF", Name: "Perf", Count: 10, Total: 100000})
			}

			raised := make([]*inventoryv1.RestockRequest, 0, 31)

			for range 31 {
				created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
					TeamId: otMelati, WarehouseId: otWarehouse, FinanceAccountId: 7, ShipmentCost: 15000, Items: items,
				}))
				if err != nil {
					t.Fatalf("raise: %v", err)
				}

				raised = append(raised, created.Msg.GetRequest())
			}

			accept := func(r *inventoryv1.RestockRequest) {
				lines := make([]*inventoryv1.RestockRequestReceivedLine, 0, size)
				for _, item := range r.GetItems() {
					lines = append(lines, &inventoryv1.RestockRequestReceivedLine{
						ItemId: item.GetId(), ReceivedCount: 10, BrokenCount: 1,
						Placements: []*inventoryv1.RestockPlacement{{PlacementId: door, Quantity: 9}},
					})
				}

				_, err := svc.RestockRequestAccept(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
					TeamId: otWarehouse, RequestId: r.GetId(), Lines: lines,
					WarehouseAdditionalCost: 5000, WarehouseAdditionalCostNote: "courier",
				}))
				if err != nil {
					t.Fatalf("accept %s lines=%d: %v", label, size, err)
				}
			}

			accept(raised[0]) // warm-up

			walls := make([]time.Duration, 0, 30)
			for _, r := range raised[1:] {
				start := time.Now()
				accept(r)
				walls = append(walls, time.Since(start))
			}

			t.Logf("S118 WRITE %s RESTOCK ACCEPT lines=%d %s", label, size, stats(walls))
		}
	}

	drop := func() {
		err := quiet.Exec("DROP INDEX " + perfSpgIndex).Error
		if err != nil {
			t.Fatalf("drop the index: %v", err)
		}
	}

	phase("WITH-1")
	drop()
	phase("WITHOUT-1")
	phase("WITHOUT-2")
	ensure()
	phase("WITH-2")
}
