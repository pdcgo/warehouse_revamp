//go:build perfaudit

// Performance audit for SupplierGoods (the audit-rpc-performance skill) — the supplier pages' Terjual / Siap / Gudang
// terkait — against 200 000 batches (50 000 restocks × 4 lines), 500 000 orders writing 1 000 000 batch rows, and one
// big supplier holding a tenth of every batch.
//
//	go test -tags perfaudit -p 1 -run TestPerf_SupplierGoods -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

const perfBigSupplier uint64 = 7

// perfSupplierGoodsBackground: a restock's batches name supplier 7 for every tenth restock, none for a third of the
// rest, and one of 3 000 suppliers (100…3 099) otherwise; every order takes two batch rows, one in fifty rolled back.
func perfSupplierGoodsBackground(t *testing.T, db *gorm.DB) {
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
		`WITH bounds AS (SELECT MIN(id) lo, MAX(id) - MIN(id) span FROM batches),
		 t AS (
		   INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, is_rollback, created_at, updated_at)
		   SELECT 5 + (g % 20), 100 + (g % 30), 'order', g % 50 = 0, NOW() - g * INTERVAL '1 minute', NOW()
		   FROM generate_series(1, 500000) g
		   RETURNING id, warehouse_id, team_id, created_at
		 )
		 INSERT INTO batch_logs (warehouse_id, team_id, batch_id, transaction_id, change_type, change_count, change_valuation,
		                         stock_count_after, stock_valuation_after, price_unit_after, description, actor_id, created_at)
		 SELECT t.warehouse_id, t.team_id, bounds.lo + ((t.id * 7919 + n * 104729) % bounds.span), t.id, 'order', -1, -10000,
		        1, 10000, 10000, '', 1, t.created_at
		 FROM t CROSS JOIN bounds CROSS JOIN generate_series(1, 2) n`,
		"ANALYZE batches",
		"ANALYZE batch_logs",
		"ANALYZE inventory_transactions",
	} {
		err := quiet.Exec(sql).Error
		if err != nil {
			t.Fatalf("supplier goods background: %v", err)
		}
	}
}

func TestPerf_SupplierGoods(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfSupplierGoodsBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil)

	read := func(group inventoryv1.SupplierGoodsGroup, ids []uint64) func(int) error {
		return func(int) error {
			_, err := svc.SupplierGoods(ctxUser(1), connect.NewRequest(&inventoryv1.SupplierGoodsRequest{
				TeamId: 100, SupplierIds: ids, Group: group,
			}))

			return err
		}
	}

	page := make([]uint64, 0, 50)
	for i := range 50 {
		page = append(page, 101+uint64(i)*3)
	}

	perfRun(t, db, probe, "SupplierGoods list page of 50", 50, read(inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_SUPPLIER, page))
	perfRun(t, db, probe, "SupplierGoods list page with the big supplier", 50,
		read(inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_SUPPLIER, append([]uint64{perfBigSupplier}, page[:49]...)))
	perfRun(t, db, probe, "SupplierGoods big supplier by store", 1,
		read(inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE, []uint64{perfBigSupplier}))
	perfRun(t, db, probe, "SupplierGoods big supplier by warehouse", 1,
		read(inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_WAREHOUSE, []uint64{perfBigSupplier}))
	perfRun(t, db, probe, "SupplierGoods small supplier by warehouse", 1,
		read(inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_WAREHOUSE, []uint64{101}))
}
