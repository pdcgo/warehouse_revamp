//go:build perfaudit

// Performance probe for the range pills' seam, SupplierIDsByFigure (the-range-pills-are-a-fixed-set) — over SupplierGoods'
// background: 200 000 batches, 1 000 000 `order` batch rows, 3 001 suppliers.
//
//	go test -tags perfaudit -p 1 -run TestPerf_SupplierIDsByFigure -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

func TestPerf_SupplierIDsByFigure(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfSupplierGoodsBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil)

	read := func(figure inventory_v1.SupplierFigure, lo, hi int64) func(int) error {
		return func(int) error {
			_, err := svc.SupplierIDsByFigure(context.Background(), figure, lo, hi)

			return err
		}
	}

	perfRun(t, db, probe, "Terjual ≥ 500 (the complement of < 500)", 1, read(inventory_v1.SupplierFigureSold, 500, 0))
	perfRun(t, db, probe, "Terjual 500–1.000", 1, read(inventory_v1.SupplierFigureSold, 500, 1_000))
	perfRun(t, db, probe, "Siap ≥ 50 (the complement of < 50)", 1, read(inventory_v1.SupplierFigureReady, 50, 0))
	perfRun(t, db, probe, "Siap 50–100", 1, read(inventory_v1.SupplierFigureReady, 50, 100))
}
