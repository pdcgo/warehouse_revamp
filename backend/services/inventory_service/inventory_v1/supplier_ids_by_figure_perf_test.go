//go:build perfaudit

// Performance probe for the range pills' seam, SupplierIDsByFigure (the-range-pills-are-a-fixed-set) — over SupplierGoods'
// background: 200 000 batches, 1 000 000 `order` batch rows, 3 001 suppliers — folded into inventory_stock_daily_changes
// exactly as inventory 00042's backfill does, since the Terjual band reads that fold
// (the-terjual-band-reads-the-daily-sold-fold). The ledger query it replaced (ledgerSoldIDs, the equality test's guard)
// is timed beside it on the same seed, old then new and new then old.
//
//	go test -tags perfaudit -p 1 -run TestPerf_SupplierIDsByFigure -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"slices"
	"testing"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// perfFoldDailyChanges folds a seeded ledger into inventory_stock_daily_changes as inventory 00042's backfill does — the
// rows every stock transaction would have written beside its logs.
func perfFoldDailyChanges(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	for _, sql := range []string{
		`DELETE FROM inventory_stock_daily_changes`,
		`INSERT INTO inventory_stock_daily_changes
		     (day, warehouse_id, team_id, product_id, supplier_id, change_type, change_count, change_value)
		 SELECT (l.created_at AT TIME ZONE 'Asia/Jakarta')::date, l.warehouse_id, l.team_id, b.product_id, b.supplier_id,
		        l.change_type, SUM(l.change_count), SUM(l.change_valuation)
		 FROM batch_logs l
		 JOIN batches b ON b.id = l.batch_id
		 WHERE b.product_id > 0
		 GROUP BY 1, 2, 3, 4, 5, 6`,
		"ANALYZE inventory_stock_daily_changes",
	} {
		err := quiet.Exec(sql).Error
		if err != nil {
			t.Fatalf("fold the seed: %v", err)
		}
	}
}

func TestPerf_SupplierIDsByFigure(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfSupplierGoodsBackground(t, db)
	perfFoldDailyChanges(t, db)

	var counts struct {
		OrderLogs int64
		FoldRows  int64
	}

	err := db.Raw(`SELECT
		  (SELECT COUNT(*) FROM batch_logs WHERE change_type = 'order') AS order_logs,
		  (SELECT COUNT(*) FROM inventory_stock_daily_changes WHERE change_type = 'order') AS fold_rows`).Scan(&counts).Error
	if err != nil {
		t.Fatal(err)
	}

	t.Logf("order rows: batch_logs %d, fold %d (the synthetic seed hits a random batch per row, so it barely compresses)",
		counts.OrderLogs, counts.FoldRows)

	svc := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	read := func(figure inventory_v1.SupplierFigure, lo, hi int64) func(int) error {
		return func(int) error {
			_, err := svc.SupplierIDsByFigure(context.Background(), figure, lo, hi)

			return err
		}
	}

	ledger := func(lo, hi int64) func(int) error {
		return func(int) error {
			ledgerSoldIDs(t, db, lo, hi)

			return nil
		}
	}

	// The same figure at volume for every supplier — the ledger's per supplier against the fold's, in one comparison.
	var mismatches, suppliers int64

	err = db.Raw(`
		WITH ledger AS (
		  SELECT b.supplier_id, -SUM(l.change_count) AS sold
		  FROM batch_logs l JOIN batches b ON b.id = l.batch_id
		  WHERE l.change_type = 'order' AND b.supplier_id <> 0
		  GROUP BY 1),
		fold AS (
		  SELECT supplier_id, -SUM(change_count) AS sold
		  FROM inventory_stock_daily_changes
		  WHERE change_type = 'order' AND supplier_id <> 0
		  GROUP BY 1)
		SELECT COUNT(*) FILTER (WHERE ledger.sold IS DISTINCT FROM fold.sold), COUNT(*)
		FROM ledger FULL JOIN fold USING (supplier_id)`).Row().Scan(&mismatches, &suppliers)
	if err != nil || mismatches != 0 {
		t.Fatalf("at volume, %d of %d suppliers' Terjual differ (%v)", mismatches, suppliers, err)
	}

	t.Logf("at volume, every supplier's Terjual: %d suppliers, 0 differ", suppliers)

	// The same answer at volume: every pill's question (the 0-start pill asked as its complement), and bands through the
	// bulk of the seed's suppliers.
	for _, band := range [][2]int64{{500, 0}, {500, 1_000}, {1_000, 2_500}, {2_500, 5_000}, {5_000, 0}, {0, 0}, {100, 200},
		{200, 300}, {300, 400}} {
		now, err := svc.SupplierIDsByFigure(context.Background(), inventory_v1.SupplierFigureSold, band[0], band[1])
		if err != nil {
			t.Fatal(err)
		}

		old := ledgerSoldIDs(t, db, band[0], band[1])
		if !slices.Equal(old, now) {
			t.Fatalf("at volume, Terjual %v: ledger %d ids, fold %d ids", band, len(old), len(now))
		}

		t.Logf("at volume, Terjual %v: %d ids, equal", band, len(now))
	}

	perfRun(t, db, probe, "BEFORE (ledger) Terjual ≥ 500 (the complement of < 500)", 1, ledger(500, 0))
	perfRun(t, db, probe, "AFTER (fold) Terjual ≥ 500 (the complement of < 500)", 1, read(inventory_v1.SupplierFigureSold, 500, 0))
	perfRun(t, db, probe, "AFTER (fold) Terjual 500–1.000", 1, read(inventory_v1.SupplierFigureSold, 500, 1_000))
	perfRun(t, db, probe, "BEFORE (ledger) Terjual 500–1.000", 1, ledger(500, 1_000))
	perfRun(t, db, probe, "Siap ≥ 50 (the complement of < 50)", 1, read(inventory_v1.SupplierFigureReady, 50, 0))
	perfRun(t, db, probe, "Siap 50–100", 1, read(inventory_v1.SupplierFigureReady, 50, 100))
}
