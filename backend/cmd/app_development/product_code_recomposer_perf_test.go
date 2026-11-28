//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for THE TEAM CODE EDIT (backlog #149,
// a-team-code-change-recomposes-its-product-codes): TeamCodeUpdate through the real seam — team_service's row lock and
// former code, product_service's set-based recompose (advisory lock, left-alone count, clash check, the clear, ONE
// statement that moves the codes and writes the history lines, the shelves read from inventory's placements in the same
// tx, ONE statement for the reprint waits and the tags). ONE seed: 150 000 background products in five other teams (half
// on a shelf), a team of 5 000 and a team of 50 000 (10 % archived), each with 75 % holding units on a shelf in warehouse
// A, 15 % in warehouse B too and 5 % on a shelf in B at 0. The FIRST change of each (ABC → XYZ, nothing to clear) and a
// SECOND one (XYZ → QWE, every wait and tag re-set, ⚠7), each timed with its statement count and per-statement db time;
// the 50 000 first change's SELECTs EXPLAINed.
//
// THE STATEMENT COUNT MUST NOT MOVE WITH THE PRODUCTS — a statement per product would be a loop, heavy at any size. The
// < 1 s target is reported, not asserted: it is missed on this host (audits/services/product_service/performances/
// TeamCodeUpdate.md — 🟡 heavy, the owner's options there).
//
//	go test -tags perfaudit -p 1 -count=1 -timeout 15m -run 'TestPerf_TeamCodeUpdate' -v ./backend/cmd/app_development/
package main

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
)

const (
	perfTcWarehouseA uint64 = 9_149_101
	perfTcWarehouseB uint64 = 9_149_102
)

// perfTcSeed writes the background and the two teams; it answers the two teams' ids.
func perfTcSeed(t *testing.T, db *gorm.DB) (small, big uint64) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	team := func(name, code string) uint64 {
		row := team_service_models.Team{Type: "selling", Name: name, TeamCode: code}

		err := quiet.Create(&row).Error
		if err != nil {
			t.Fatal(err)
		}

		return row.ID
	}

	small = team("Toko Perf 5k", "PRF5-ABC")
	big = team("Toko Perf 50k", "PRF50-ABC")

	exec := func(sql string, args ...any) {
		t.Helper()

		err := quiet.Exec(sql, args...).Error
		if err != nil {
			t.Fatalf("%s: %v", sql[:min(len(sql), 80)], err)
		}
	}

	// Background: five other teams' catalogues (their codes under their own prefixes).
	exec(`INSERT INTO products (team_id, product_code, name, category_id, archived)
		SELECT 9149200 + g % 5, 'PRF-BG' || (g % 5) || '-' || lpad(g::text, 7, '0'), 'Latar ' || g, 1, g % 10 = 3
		FROM generate_series(1, 150000) g`)

	exec(`INSERT INTO products (team_id, product_code, name, category_id, archived)
		SELECT ?, 'PRF5-ABC-' || lpad(g::text, 6, '0'), 'Kecil ' || g, 1, g % 10 = 3 FROM generate_series(1, 5000) g`, small)
	exec(`INSERT INTO products (team_id, product_code, name, category_id, archived)
		SELECT ?, 'PRF50-ABC-' || lpad(g::text, 6, '0'), 'Besar ' || g, 1, g % 10 = 3 FROM generate_series(1, 50000) g`, big)

	for _, w := range []uint64{perfTcWarehouseA, perfTcWarehouseB} {
		exec(`INSERT INTO placements (warehouse_id, code, name) SELECT ?, 'perf-tc-' || g, 'Rak' FROM generate_series(1, 20) g`, w)
	}

	shelf := func(where string, warehouse uint64, stock int) {
		exec(`INSERT INTO product_placements (team_id, warehouse_id, product_id, placement_id, stock_count)
			SELECT p.team_id, ?, p.id,
			       (SELECT id FROM placements WHERE warehouse_id = ? AND code = 'perf-tc-' || (1 + p.id % 20)), ?
			FROM products p WHERE `+where, warehouse, warehouse, stock)
	}

	ours := "p.team_id IN (" + fmt.Sprint(small) + ", " + fmt.Sprint(big) + ")"

	shelf(ours+" AND p.id % 20 < 12", perfTcWarehouseA, 5)
	shelf(ours+" AND p.id % 20 IN (12, 13, 14)", perfTcWarehouseA, 3)
	shelf(ours+" AND p.id % 20 < 3", perfTcWarehouseB, 3)
	shelf(ours+" AND p.id % 20 = 15", perfTcWarehouseB, 0)
	shelf("p.product_code LIKE 'PRF-BG%' AND p.id % 2 = 0", perfTcWarehouseA, 7)

	exec(`ANALYZE products`)
	exec(`ANALYZE product_placements`)
	exec(`ANALYZE product_tag_links`)
	exec(`ANALYZE product_reprint_waits`)
	exec(`ANALYZE product_logs`)

	return small, big
}

func TestPerf_TeamCodeUpdate(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	small, big := perfTcSeed(t, db)

	statements := map[string]int{}

	products := product_v1.NewService(db, nil, nil, NewProductStockNarrower(db), nil)
	teams := team_v1.NewService(db, nil, NewProductCodeRecomposer(products))

	for _, c := range []struct {
		name     string
		team     uint64
		to       string
		products int
	}{
		{"5 000 · first change", small, "PRF5-XYZ", 5_000},
		{"50 000 · first change", big, "PRF50-XYZ", 50_000},
		{"5 000 · second change (re-set)", small, "PRF5-QWE", 5_000},
		{"50 000 · second change (re-set)", big, "PRF50-QWE", 50_000},
	} {
		probe.Reset()

		var resp *connect.Response[teamv1.TeamCodeUpdateResponse]

		wall, inDB := probe.Measure(func() {
			var err error

			resp, err = teams.TeamCodeUpdate(asOwnerOf(c.team), connect.NewRequest(&teamv1.TeamCodeUpdateRequest{TeamId: c.team, TeamCode: c.to}))
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}
		})

		got := resp.Msg
		if int(got.GetProductsRecomposed()) != c.products {
			t.Fatalf("%s: recomposed %d, want %d", c.name, got.GetProductsRecomposed(), c.products)
		}

		t.Logf("%s: wall %s, db %s, %d queries — %d recomposed, %d tagged", c.name, wall.Round(time.Millisecond),
			inDB.Round(time.Millisecond), probe.Count(), got.GetProductsRecomposed(), got.GetProductsTagged())

		statements[c.name] = probe.Count()
		queries := probe.Queries()
		probe.Report(t, "TeamCodeUpdate "+c.name)

		if c.products == 50_000 && strings.Contains(c.name, "first") {
			for _, q := range queries {
				sql := strings.TrimSpace(q.SQL)
				if !strings.HasPrefix(sql, "SELECT") || strings.Contains(sql, "pg_advisory_xact_lock") {
					continue
				}

				san_perf.Explain(t, db, sql)
			}
		}

		if wall > time.Second {
			t.Logf("🟡 HEAVY: %s took %s — over the 1 s target (TeamCodeUpdate.md)", c.name, wall.Round(time.Millisecond))
		}
	}

	first := statements["5 000 · first change"]
	for name, count := range statements {
		if count != first {
			t.Errorf("%s ran %d statements, the 5 000 first change %d — the count moved with the products (a loop?)", name, count, first)
		}
	}
}
