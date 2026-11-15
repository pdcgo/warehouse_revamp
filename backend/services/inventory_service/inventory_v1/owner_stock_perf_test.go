//go:build perfaudit

package inventory_v1_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// THE OWNER'S STOCK READS AT VOLUME, with the in-transit figure (the-transfer-is-where-goods-in-transit-are). On the
// ledger background (team 2: 50 000 batches over 2 500 products in 20 warehouses, 10 000 restocks) plus:
//
//	warehouse_transfers       50 000   five teams × 10 000 over the years; per team 200 open (40 each created, process,
//	                                   shipped, arrived, lost), 200 cancelled, 9 600 accepted
//	warehouse_transfer_items ~100 000  two lines each, over the same 2 500 products (a hash of the transfer picks them)
//
// The page asks for products that ALL have something on the road (the worst page): 20 and 200 of them, with and
// without the lens. Each case runs under the custom plan and under `plan_cache_mode = force_generic_plan` (pgx prepares
// every statement; Postgres switches to the generic plan after five runs), first with inventory 00045's partial index
// `warehouse_transfers_in_transit_idx (team_id, to_warehouse_id) WHERE <the in-transit predicate>` dropped inside the
// test's own transaction, then with it rebuilt — the before and after of the pure index.
func TestPerf_OwnerStockInTransit(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	perfLedgerBackground(t, db)
	perfTransfers(t, db)

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	var page []uint64

	err := quiet.Raw(`
		SELECT DISTINCT i.product_id FROM warehouse_transfers t JOIN warehouse_transfer_items i ON i.transfer_id = t.id
		WHERE t.team_id = 2 AND t.status IN ('created', 'process', 'shipped', 'arrived', 'lost')
		ORDER BY 1 LIMIT 200`).Scan(&page).Error
	if err != nil || len(page) < 200 {
		t.Fatalf("page: %v (%d ids)", err, len(page))
	}

	// A receiving warehouse of team 2's open transfers (to = 1 + (g + 7) % 20 for g % 5 = 0).
	const lens uint64 = 8

	svc := newService(t, db)
	ctx := context.Background()

	byIds := func(n int, warehouse uint64) func() error {
		return func() error {
			_, callErr := svc.OwnerStockByIds(ctx, connect.NewRequest(&inventoryv1.OwnerStockByIdsRequest{
				TeamId: 2, Filter: &inventoryv1.OwnerStockByIdsFilter{ProductIds: page[:n], WarehouseId: warehouse},
			}))

			return callErr
		}
	}

	stat := func(warehouse uint64) func() error {
		return func() error {
			_, callErr := svc.OwnerStockStat(ctx, connect.NewRequest(&inventoryv1.OwnerStockStatRequest{
				TeamId: 2, Filter: &inventoryv1.OwnerStockStatFilter{WarehouseId: warehouse},
			}))

			return callErr
		}
	}

	cases := []struct {
		name string
		call func() error
	}{
		{"OwnerStockByIds 20", byIds(20, 0)},
		{"OwnerStockByIds 200", byIds(200, 0)},
		{"OwnerStockByIds 200 lens", byIds(200, lens)},
		{"OwnerStockStat", stat(0)},
		{"OwnerStockStat lens", stat(lens)},
		// The plain join the fence replaced, kept here as the comparison: hashed, it scans every transfer line.
		{"plain join 20 (not shipped)", plainJoin(db, page[:20])},
		{"plain join 200 (not shipped)", plainJoin(db, page)},
	}

	run := func(phase string, explain bool) {
		for _, plan := range []string{"auto", "force_generic_plan"} {
			err := quiet.Exec("SET plan_cache_mode = " + plan).Error
			if err != nil {
				t.Fatalf("plan_cache_mode: %v", err)
			}

			for _, c := range cases {
				name := phase + " · " + plan + " · " + c.name
				walls, transit := make([]time.Duration, 0, 7), make([]time.Duration, 0, 7)

				// Seven warm runs first, so the generic plan is the one measured when it is forced.
				for range 7 {
					callErr := c.call()
					if callErr != nil {
						t.Fatalf("%s warm-up: %v", name, callErr)
					}
				}

				var last []san_perf.Query

				for range 7 {
					probe.Reset()

					var callErr error

					wall, _ := probe.Measure(func() { callErr = c.call() })
					if callErr != nil {
						t.Fatalf("%s: %v", name, callErr)
					}

					walls = append(walls, wall)
					last = probe.Queries()

					for _, q := range last {
						if strings.Contains(q.SQL, "warehouse_transfer_items") {
							transit = append(transit, q.Duration)
						}
					}
				}

				t.Logf("%s: MEDIAN wall %v, in-transit statement %v, %d statements", name,
					san_perf.Median(walls), san_perf.Median(transit), len(last))

				if explain && plan == "auto" {
					probe.Report(t, name)

					// The in-transit statement every time; the stat's other three (the pre-existing reads) once, as the
					// whole RPC's picture.
					for _, q := range last {
						if strings.Contains(q.SQL, "warehouse_transfer_items") || c.name == "OwnerStockStat" {
							san_perf.Explain(t, db, q.SQL)
						}
					}
				}
			}
		}

		err := quiet.Exec("RESET plan_cache_mode").Error
		if err != nil {
			t.Fatalf("reset plan_cache_mode: %v", err)
		}
	}

	// Before: inventory 00045's index dropped inside the test's transaction (rolled back with it).
	err = quiet.Exec("DROP INDEX warehouse_transfers_in_transit_idx").Error
	if err != nil {
		t.Fatalf("drop the in-transit index: %v", err)
	}

	run("without the in-transit index", true)

	// After: the index exactly as 00045 builds it.
	err = quiet.Exec(`CREATE INDEX warehouse_transfers_in_transit_idx ON warehouse_transfers (team_id, to_warehouse_id)
		WHERE outbound_transaction_id IS NOT NULL AND status IN ('created', 'process', 'shipped', 'arrived', 'lost')`).Error
	if err != nil {
		t.Fatalf("the in-transit index: %v", err)
	}

	err = quiet.Exec("ANALYZE warehouse_transfers").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	run("with warehouse_transfers_in_transit_idx (00045)", true)
}

// plainJoin is the in-transit read as a plain join of transfers and lines — what OwnerStockByIds first ran.
func plainJoin(db *gorm.DB, page []uint64) func() error {
	return func() error {
		var rows []struct {
			ProductID uint64
			Qty       int64
			Value     float64
		}

		return db.Raw(`
			SELECT i.product_id AS product_id, COALESCE(SUM(i.count), 0) AS qty, COALESCE(SUM(i.total), 0) AS value
			FROM warehouse_transfers AS t JOIN warehouse_transfer_items i ON i.transfer_id = t.id
			WHERE t.team_id = ? AND t.outbound_transaction_id IS NOT NULL
			  AND t.status IN ('created', 'process', 'shipped', 'arrived', 'lost') AND i.product_id IN ?
			GROUP BY i.product_id`, 2, page).Scan(&rows).Error
	}
}

// perfTransfers seeds the transfer volume above, set-based; every out-leg points at a background transaction (the read
// never joins it, the foreign key only needs it to exist).
func perfTransfers(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO warehouse_transfers (team_id, from_warehouse_id, to_warehouse_id, status, note, total,
		                                  outbound_transaction_id, inbound_transaction_id, created_by_user_id,
		                                  accepted_at, cancelled_at, created_at, updated_at)
		 SELECT 2 + g % 5, 1 + g % 20, 1 + (g + 7) % 20, s.status, 'perf-bg', 2000,
		        x.first + g % 50000,
		        CASE WHEN s.status = 'accepted' THEN x.first + (g + 1) % 50000 END,
		        1,
		        CASE WHEN s.status = 'accepted' THEN now() END,
		        CASE WHEN s.status = 'cancel' THEN now() END,
		        now() - (50001 - g) * interval '10 minutes', now()
		 FROM generate_series(1, 50000) g
		 CROSS JOIN (SELECT min(id) AS first FROM inventory_transactions WHERE description = 'perf-bg') x
		 CROSS JOIN LATERAL (SELECT CASE
		     WHEN (g / 5) % 50 = 0 THEN (ARRAY['created', 'process', 'shipped', 'arrived', 'lost'])[1 + (g / 250) % 5]
		     WHEN (g / 5) % 50 = 1 THEN 'cancel'
		     ELSE 'accepted' END AS status) s`,

		`INSERT INTO warehouse_transfer_items (transfer_id, product_id, product_code, name, count, price_unit, total,
		                                       created_at)
		 SELECT t.id, 100000 + abs(hashint8(t.id * 2 + k)) % 2500, 'PERF', 'perf', 1 + t.id % 5, 1000,
		        (1 + t.id % 5) * 1000, t.created_at
		 FROM warehouse_transfers t CROSS JOIN generate_series(0, 1) k WHERE t.note = 'perf-bg'
		 ON CONFLICT (transfer_id, product_id) DO NOTHING`,
	}

	for _, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("transfer seed: %v\n%s", err, statement)
		}
	}

	for _, table := range []string{"warehouse_transfers", "warehouse_transfer_items"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}

	var open, all int64

	quiet.Raw(`SELECT count(*) FILTER (WHERE status IN ('created', 'process', 'shipped', 'arrived', 'lost')), count(*)
		FROM warehouse_transfers WHERE team_id = 2`).Row().Scan(&open, &all)
	t.Logf("team 2: %d transfers, %d open", all, open)
}
