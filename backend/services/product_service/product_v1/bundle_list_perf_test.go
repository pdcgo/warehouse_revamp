//go:build perfaudit

package product_v1_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// The bundle audit's seed (docs/business/product/product_bundle.md). Bundles and products are ENTITY tables — 10 000
// each — spread over forty selling teams, so the scope clause has 39 teams' rows to leave out; the audited team holds
// 250 bundles. Every bundle has three lines, so bundle_products holds 30 000. One product in seven is called "Gula …",
// so a search for "gula" matches a real slice of the team rather than everything or nothing.
//
// The search was also run once at 10× (100 000 bundles, 300 000 lines) — audits/services/product_service/performances/
// BundleList.md holds both.
const (
	perfBundleTeam     uint64 = 2
	perfBundleTeams           = 40
	perfBundleProducts        = 10_000
	perfBundleBundles         = 10_000
	perfBundleLines           = 3
)

type bundleSeed struct {
	products map[uint64][]uint64 // team → its product ids
	team     []uint64            // the audited team's bundle ids, newest last
}

func seedBundles(t *testing.T, db *gorm.DB) bundleSeed {
	t.Helper()

	products := make([]product_service_models.Product, 0, perfBundleProducts)
	for i := range perfBundleProducts {
		name := fmt.Sprintf("Produk %d", i)
		if i%7 == 0 {
			name = fmt.Sprintf("Gula %d", i)
		}
		products = append(products, product_service_models.Product{
			TeamID: perfBundleTeam + uint64(i%perfBundleTeams),
			SKU:    fmt.Sprintf("SKU-%05d", i),
			Name:   name,
		})
	}
	san_perf.SeedRows(t, db, &products)

	byTeam := map[uint64][]uint64{}
	for _, p := range products {
		byTeam[p.TeamID] = append(byTeam[p.TeamID], p.ID)
	}

	now := time.Now()
	bundles := make([]product_service_models.Bundle, 0, perfBundleBundles)
	for i := range perfBundleBundles {
		bundles = append(bundles, product_service_models.Bundle{
			TeamID:          perfBundleTeam + uint64(i%perfBundleTeams),
			Name:            fmt.Sprintf("Paket %d", i%300), // names repeat, as they may
			CreatedByUserID: 61,
			CreatedAt:       now.Add(-time.Duration(i) * time.Minute),
			UpdatedAt:       now.Add(-time.Duration(i) * time.Minute),
		})
	}
	san_perf.SeedRows(t, db, &bundles)

	seed := bundleSeed{products: byTeam}
	lines := make([]product_service_models.BundleProduct, 0, perfBundleBundles*perfBundleLines)
	for i, b := range bundles {
		own := byTeam[b.TeamID]
		for j := range perfBundleLines {
			lines = append(lines, product_service_models.BundleProduct{
				BundleID:  b.ID,
				ProductID: own[(i*perfBundleLines+j)%len(own)],
				Quantity:  uint32(1 + j),
			})
		}
		if b.TeamID == perfBundleTeam {
			seed.team = append(seed.team, b.ID)
		}
	}
	san_perf.SeedRows(t, db, &lines)

	return seed
}

func perfService(t *testing.T) (*product_v1.Service, *gorm.DB, *san_perf.Probe, bundleSeed) {
	t.Helper()

	db, probe := san_perf.Wrap(san_testdb.DB(t))
	seed := seedBundles(t, db)

	return product_v1.NewService(db), db, probe, seed
}

func perfCtx() context.Context {
	return asPerson(61, role_basev1.Role_ROLE_SELLING_OWNER)
}

// measure runs `call` once warm, then five times, logging each run and the median — the skill's step 3.
func measure(t *testing.T, probe *san_perf.Probe, name string, call func() error) {
	t.Helper()

	err := call()
	if err != nil {
		t.Fatalf("%s (warm-up): %v", name, err)
	}

	walls := make([]time.Duration, 0, 5)
	for range 5 {
		probe.Reset()

		wall, dbTime := probe.Measure(func() { err = call() })
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		walls = append(walls, wall)
		t.Logf("%s: wall=%v db=%v go=%v queries=%d", name, wall, dbTime, wall-dbTime, probe.Count())
	}

	t.Logf("%s: median wall %v", name, san_perf.Median(walls))
	probe.Report(t, name)
}

// explainReads EXPLAINs every SELECT the probe recorded — never a write (EXPLAIN ANALYZE would run it) nor the SAVEPOINT
// the per-test transaction makes of GORM's nested Transaction.
func explainReads(t *testing.T, db *gorm.DB, probe *san_perf.Probe) {
	t.Helper()

	for _, q := range probe.Queries() {
		if strings.HasPrefix(strings.ToUpper(strings.TrimSpace(q.SQL)), "SELECT") {
			t.Logf("EXPLAIN %s\n%s", q.SQL, san_perf.Explain(t, db, q.SQL))
		}
	}
}

func TestPerf_BundleList(t *testing.T) {
	svc, db, probe, _ := perfService(t)
	ctx := perfCtx()

	for _, limit := range []uint32{20, 200} {
		name := fmt.Sprintf("BundleList limit=%d", limit)
		measure(t, probe, name, func() error {
			_, err := svc.BundleList(ctx, connect.NewRequest(&productv1.BundleListRequest{
				TeamId: perfBundleTeam,
				Page:   &commonv1.CommonPagination{Page: 1, Limit: limit},
			}))
			return err
		})
	}

	// The search: the bundle's name OR a line's product — the EXISTS over bundle_products ⋈ products.
	measure(t, probe, "BundleList q=gula", func() error {
		_, err := svc.BundleList(ctx, connect.NewRequest(&productv1.BundleListRequest{
			TeamId: perfBundleTeam,
			Filter: &productv1.BundleListFilter{Q: "gula"},
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
		}))
		return err
	})

	explainReads(t, db, probe)
}
