//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for ProductDerivedList — Produk Turunan, the return map read both
// ways across teams (produk-turunan-is-the-return-map). At 10 000 and 50 000 maps, with selling's 00056 indexes on
// `shared_product_id` and `own_product_id` (a-pure-index-is-added-without-asking), and — measure-only, inside the
// rolled-back test transaction — without them, so the gain they bought stays measurable.
//
//	go test -tags perfaudit -run TestPerf_ProductDerivedList -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

const (
	perfDerivedTeams  = 500     // selling teams holding maps
	perfDerivedShared = 40_000  // borrowed products they map
	perfDerivedTarget = 99      // the borrowed product the page opens: 25 teams map it
	perfDerivedOwn    = 999_999 // the own product the page opens: three borrowed products land on it
)

// perfDerivedRows is n maps over 500 teams — each team's borrowed products spread over 40 000, unique per team as the
// table requires — plus the page's two products: 25 teams' maps of perfDerivedTarget, and three of team 100's
// borrowed products landing on perfDerivedOwn.
func perfDerivedRows(n int) []selling_service_models.ProductReturnMap {
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	rows := make([]selling_service_models.ProductReturnMap, 0, n+28)

	for i := range n {
		team := uint64(100 + i%perfDerivedTeams)
		k := uint64(i / perfDerivedTeams)
		at := base.Add(time.Duration(i) * time.Minute)

		rows = append(rows, selling_service_models.ProductReturnMap{
			TeamID:          team,
			SharedProductID: 100_000 + (team*37+k*401)%perfDerivedShared,
			OwnProductID:    1_000_000 + uint64(i),
			CreatedAt:       at,
			UpdatedAt:       at,
		})
	}

	for j := range 25 {
		at := base.Add(time.Duration(n+j) * time.Minute)
		rows = append(rows, selling_service_models.ProductReturnMap{
			TeamID: uint64(10_000 + j), SharedProductID: perfDerivedTarget, OwnProductID: uint64(2_000_000 + j),
			CreatedAt: at, UpdatedAt: at,
		})
	}

	for j := range 3 {
		at := base.Add(time.Duration(n+30+j) * time.Minute)
		rows = append(rows, selling_service_models.ProductReturnMap{
			TeamID: 100, SharedProductID: uint64(90_000 + j), OwnProductID: perfDerivedOwn,
			CreatedAt: at, UpdatedAt: at,
		})
	}

	return rows
}

func TestPerf_ProductDerivedList(t *testing.T) {
	for _, n := range []int{10_000, 50_000} {
		t.Run(fmt.Sprintf("%d_maps", n), func(t *testing.T) {
			perfDerived(t, n)
		})
	}
}

func perfDerived(t *testing.T, n int) {
	tx := san_testdb.DB(t)
	db, probe := san_perf.Wrap(tx)
	san_perf.SeedRows(t, db, perfDerivedRows(n))
	analyze(t, tx)

	svc := newReturnMapService(t, db)
	ctx := context.Background()

	read := func(productID uint64) *sellingv1.ProductDerivedListResponse {
		res, err := svc.ProductDerivedList(ctx, connect.NewRequest(&sellingv1.ProductDerivedListRequest{
			TeamId: derivedReader,
			Filter: &sellingv1.ProductDerivedListFilter{ProductId: productID},
		}))
		if err != nil {
			t.Fatalf("ProductDerivedList(%d): %v", productID, err)
		}

		return res.Msg
	}

	measure := func(label string, productID uint64) []san_perf.Query {
		read(productID) // warm-up

		walls := make([]time.Duration, 0, 5)

		var queries []san_perf.Query

		for range 5 {
			probe.Reset()

			var got *sellingv1.ProductDerivedListResponse

			wall, dbTime := probe.Measure(func() {
				got = read(productID)
			})

			walls = append(walls, wall)
			queries = probe.Queries()

			t.Logf("%s @%d maps: wall=%v db=%v go=%v queries=%d from=%d to=%d", label, n, wall, dbTime, wall-dbTime,
				probe.Count(), got.GetDerivedFromTotal(), got.GetDerivedToTotal())
		}

		t.Logf("%s @%d maps: median wall %v", label, n, san_perf.Median(walls))
		probe.Report(t, label)

		return queries
	}

	explainAll := func(label string, queries []san_perf.Query) {
		for _, q := range queries {
			plan := san_perf.Explain(t, db, q.SQL)
			t.Logf("%s plan has a Seq Scan: %v", label, strings.Contains(plan, "Seq Scan"))
		}
	}

	// The page opens (00056's indexes in place): Turunannya of a product 25 teams map, Turunan dari of one three land on,
	// and one nobody maps.
	explainAll("today · borrowed product", measure("today · borrowed product (25 teams map it)", perfDerivedTarget))
	explainAll("today · own product", measure("today · own product (3 land on it)", perfDerivedOwn))
	measure("today · a product no map names", 77)

	// The table's one writer (ProductReturnMapCreate's INSERT … ON CONFLICT DO NOTHING), timed with and without them.
	writes := func(label string, from int) {
		start := time.Now()

		for i := range 500 {
			err := tx.Exec(`INSERT INTO product_return_maps (team_id, shared_product_id, own_product_id, created_at, updated_at)
				VALUES (?, ?, ?, now(), now()) ON CONFLICT (team_id, shared_product_id) DO NOTHING`,
				30_000+from+i, 77_000+i, 3_000_000+from+i).Error
			if err != nil {
				t.Fatalf("%s write %d: %v", label, i, err)
			}
		}

		t.Logf("%s @%d maps: 500 map writes in %v (%v each)", label, n, time.Since(start), time.Since(start)/500)
	}

	writes("writer · today", 0)

	// MEASURE-ONLY: 00056's two indexes dropped inside this rolled-back transaction — the table as it was before them.
	withoutIndexes(t, tx)
	explainAll("without indexes · borrowed product", measure("without indexes · borrowed product", perfDerivedTarget))
	explainAll("without indexes · own product", measure("without indexes · own product", perfDerivedOwn))
	writes("writer · without indexes", 1000)
}

// analyze refreshes the planner's statistics after the seed, so the plans read the seeded table, not an empty one.
func analyze(t *testing.T, tx *gorm.DB) {
	t.Helper()

	err := tx.Exec("ANALYZE product_return_maps").Error
	if err != nil {
		t.Fatalf("ANALYZE product_return_maps: %v", err)
	}
}

// withoutIndexes drops 00056's indexes on the test's own transaction — back with its rollback — and re-analyzes.
func withoutIndexes(t *testing.T, tx *gorm.DB) {
	t.Helper()

	for _, stmt := range []string{
		"DROP INDEX product_return_maps_shared_idx",
		"DROP INDEX product_return_maps_own_idx",
		"ANALYZE product_return_maps",
	} {
		err := tx.Exec(stmt).Error
		if err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
}
