//go:build perfaudit

package inventory_v1_test

import (
	"fmt"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// PEMASOK AT VOLUME — ProductSupplierGoods (the-supplier-tab-names-the-store) on one seed in one process: the ledger
// background (50 000 batches, no supplier) plus 250 000 restocked batches of 25 000 other products from 3 000 suppliers in
// 20 warehouses, and ONE product bought 3 000 times — 40 suppliers × 3 stores across the 20 warehouses — with 600
// transfer-ins of it and 100 received-count corrections. Measured as the owner and as another team, every warehouse and
// one, page 1 and the last page, under the custom and the generic plan (pgx prepares every statement) — with the pure
// index 00062 adds (`batches_owner_product_all_idx`, a-pure-index-is-added-without-asking) and, on the same seed, without
// it.
func TestPerf_ProductSupplierGoods(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})
	perfLedgerBackground(t, db)

	product := perfProducts(1)[0]

	statements := []string{
		// Other products, bought from many suppliers.
		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		 SELECT 1 + g % 20, 2 + g % 50, 'restock', 1, 'perf-psg' FROM generate_series(1, 250000) g`,
		`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                      init_stock_count, init_stock_valuation, supplier_id, supplier_channel_id)
		 SELECT t.warehouse_id, t.team_id, 200000 + t.id % 25000, t.id, 1000, t.id % 7, (t.id % 7) * 1000, 10, 10000,
		        5000 + t.id % 3000, 50000 + t.id % 9000
		 FROM inventory_transactions t WHERE t.description = 'perf-psg'`,

		// THE product: 3 000 deliveries, each its own restock, 40 suppliers × 3 stores over 20 warehouses.
		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		 SELECT 1 + g % 20, 2, 'restock', 1, 'perf-psg-target' FROM generate_series(1, 3000) g`,
		fmt.Sprintf(`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count,
		                      stock_valuation, init_stock_count, init_stock_valuation, supplier_id, supplier_channel_id,
		                      created_at)
		 SELECT t.warehouse_id, 2, %d, t.id, 1000 + t.id %% 500, t.id %% 5, (t.id %% 5) * 1000, 12, 12000,
		        700 + t.id %% 40, 7000 + t.id %% 120, NOW() - (t.id %% 900) * INTERVAL '1 hour'
		 FROM inventory_transactions t WHERE t.description = 'perf-psg-target'`, product),

		// 600 transfer-ins of it, supplier and store copied.
		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		 SELECT 1 + g % 20, 2, 'transfer_in', 1, 'perf-psg-transfer' FROM generate_series(1, 600) g`,
		fmt.Sprintf(`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count,
		                      stock_valuation, init_stock_count, init_stock_valuation, supplier_id, supplier_channel_id)
		 SELECT t.warehouse_id, 2, %d, t.id, 1000, 2, 2000, 2, 2000, 700 + t.id %% 40, 7000 + t.id %% 120
		 FROM inventory_transactions t WHERE t.description = 'perf-psg-transfer'`, product),

		// 100 received-count corrections of its batches, under one adjustment transaction.
		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		 VALUES (1, 2, 'adjustment', 1, 'perf-psg-fix')`,
		fmt.Sprintf(`INSERT INTO restock_count_corrections (restock_id, restock_item_id, product_id, warehouse_id, team_id,
		                      transaction_id, batch_id, placement_id, from_count, to_count, units_out, price_unit, total,
		                      reason)
		 SELECT r.id, i.id, %d, b.warehouse_id, 2, a.id, b.id, p.id, 12, 11, 1, b.price_unit, b.price_unit, 'perf'
		 FROM (SELECT id, warehouse_id, price_unit, row_number() OVER (ORDER BY id) n
		       FROM batches WHERE product_id = %d AND transaction_id IN
		         (SELECT id FROM inventory_transactions WHERE description = 'perf-psg-target')) b
		 JOIN (SELECT id, row_number() OVER (ORDER BY id) n FROM restocks WHERE note = 'perf-bg') r ON r.n = b.n
		 JOIN LATERAL (SELECT id FROM restock_items WHERE restock_id = r.id ORDER BY id LIMIT 1) i ON TRUE
		 JOIN LATERAL (SELECT id FROM placements WHERE description = 'perf-bg' ORDER BY id LIMIT 1) p ON TRUE
		 CROSS JOIN (SELECT id FROM inventory_transactions WHERE description = 'perf-psg-fix') a
		 WHERE b.n <= 100`, product, product),
	}

	for _, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("seed: %v\n%s", err, statement)
		}
	}

	for _, table := range []string{"inventory_transactions", "batches", "restock_count_corrections", "restocks"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}

	var batches int64

	quiet.Raw("SELECT COUNT(*) FROM batches").Scan(&batches)
	t.Logf("seed: %d batches", batches)

	svc := inventory_v1.NewService(db, nil, nil, nil, nil, perfFacts(1), nil, nil, nil, nil)

	read := func(caller, warehouse uint64, page uint32) error {
		_, err := svc.ProductSupplierGoods(ctxAs(41, caller, role_basev1.Role_ROLE_SELLING_OWNER), connect.NewRequest(&inventoryv1.ProductSupplierGoodsRequest{
			TeamId: caller,
			Filter: &inventoryv1.ProductSupplierGoodsFilter{ProductId: product, WarehouseId: warehouse},
			Page:   &commonv1.CommonPagination{Page: page, Limit: 20},
		}))

		return err
	}

	measure := func(label string) {
		for _, plan := range []string{"auto", "force_generic_plan"} {
			err := quiet.Exec("SET LOCAL plan_cache_mode = " + plan).Error
			if err != nil {
				t.Fatalf("plan mode %s: %v", plan, err)
			}

			for _, c := range []struct {
				name      string
				caller    uint64
				warehouse uint64
				page      uint32
			}{
				{"owner, every warehouse, page 1", otMelati, 0, 1},
				{"owner, every warehouse, page 6", otMelati, 0, 6},
				{"owner, one warehouse", otMelati, 7, 1},
				{"another team, every warehouse", otSinar, 0, 1},
			} {
				name := fmt.Sprintf("ProductSupplierGoods %s [%s] %s", c.name, plan, label)
				perfRun(t, db, probe, name, 1, func(int) error { return read(c.caller, c.warehouse, c.page) })

				// perfRun EXPLAINs only a statement starting SELECT; this one starts WITH.
				for _, q := range probe.Queries() {
					if strings.HasPrefix(strings.TrimSpace(q.SQL), "WITH own") {
						san_perf.Explain(t, db, q.SQL)

						break
					}
				}
			}
		}
	}

	// The first reads of a fresh seed pay its first touches (the seed is this transaction's own, uncommitted rows): warm
	// them out of the measurement, so the first case measured is not dearer than the same case later.
	for range 10 {
		err := read(otMelati, 0, 1)
		if err != nil {
			t.Fatalf("warm-up: %v", err)
		}
	}

	measure("(with 00062)")

	// BEFORE 00062, on the same seed: the index dropped inside the test transaction (rolled back with it).
	err := quiet.Exec("DROP INDEX batches_owner_product_all_idx").Error
	if err != nil {
		t.Fatalf("drop the index: %v", err)
	}

	err = quiet.Exec("ANALYZE batches").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	measure("(without 00062)")
}
