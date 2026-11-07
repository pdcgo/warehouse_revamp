//go:build perfaudit

// Performance probe for Penjualan's sales fold (SalesFoldHandler) — one OrderPlaced and its OrderCancelled of the top
// supplier, on the last seeded day of the figures book (so its rows exist and are UPDATED), at 1, 5 and 20 parts: the
// statement count must not grow with the parts.
//
// Measured by foldRun, not perfRun: perfRun's EXPLAIN ANALYZE re-executes each write after the run, and the parts'
// INSERT carries its own primary key (the order's), so its replay conflicts. The plans are primary-key lookups and one
// keyed upsert; PERF_REPORT=1 prints the statements.
//
//	go test -tags perfaudit -p 1 -run TestPerf_SalesFold -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"fmt"
	"os"
	"slices"
	"testing"
	"time"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

func TestPerf_SalesFold(t *testing.T) {
	b := figSetup(t)

	if len(b.topProducts) < 20 {
		t.Fatalf("the top supplier has %d products of team %d, need 20", len(b.topProducts), figTeamBase)
	}

	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{}}
	b.svc = supplier_v1.NewService(b.db, perfSellingTeams{}, nil, goods)
	handler := b.svc.SalesFoldHandler()

	at, err := time.ParseInLocation("2006-01-02 15:04", figLastDay+" 10:00", time.FixedZone("WIB", 7*3600))
	if err != nil {
		t.Fatalf("day: %v", err)
	}

	order := uint64(8_000_000)

	for _, size := range []int{1, 5, 20} {
		parts := make([]supplier_v1.SaleTakePart, 0, size)
		lines := make([]*eventsv1.OrderPlacedLine, 0, size)

		for i := range size {
			parts = append(parts, supplier_v1.SaleTakePart{ProductID: b.topProducts[i], SupplierID: b.top, TeamID: figTeamBase, Units: 2})
			lines = append(lines, saleLine(b.topProducts[i], 2, 30_000))
		}

		foldRun(t, b.perfBook, fmt.Sprintf("SalesFold/placed/parts=%d", size), func(int) error {
			order++
			goods.takes[order] = parts

			return handler(context.Background(), salePlaced(order, order, at, float64(size)*50_000, lines...))
		}, nil)

		foldRun(t, b.perfBook, fmt.Sprintf("SalesFold/cancelled/parts=%d", size), func(int) error {
			return handler(context.Background(), saleCancelled(order, at.Add(time.Hour)))
		}, func(int) error {
			// The placement first, outside the measure — the cancel is what is timed.
			order++
			goods.takes[order] = parts

			return handler(context.Background(), salePlaced(order, order, at, float64(size)*50_000, lines...))
		})
	}
}

// foldRun warms once, measures 5 runs (each after its own unmeasured `before`, when given) and logs one PERF line —
// perfRun's measure, without its EXPLAIN (see the file comment).
func foldRun(t *testing.T, b perfBook, name string, call, before func(i int) error) {
	t.Helper()

	walls := make([]time.Duration, 0, 5)
	dbs := make([]time.Duration, 0, 5)
	counts := make([]int, 0, 5)

	for i := -1; i < 5; i++ {
		if before != nil {
			err := before(i)
			if err != nil {
				t.Fatalf("%s before %d: %v", name, i, err)
			}
		}

		b.probe.Reset()

		var runErr error

		wall, dbTime := b.probe.Measure(func() {
			runErr = call(i)
		})
		if runErr != nil {
			t.Fatalf("%s run %d: %v", name, i, runErr)
		}

		if i < 0 {
			continue
		}

		walls = append(walls, wall)
		dbs = append(dbs, dbTime)
		counts = append(counts, b.probe.Count())
	}

	t.Logf("PERF %s median=%v db=%v max=%v queries=%v",
		name,
		san_perf.Median(walls).Round(time.Microsecond),
		san_perf.Median(dbs).Round(time.Microsecond),
		slices.Max(walls).Round(time.Microsecond),
		counts)

	if os.Getenv("PERF_REPORT") != "" {
		b.probe.Report(t, name)
	}
}
