//go:build perfaudit

// Performance audit (the audit-rpc-performance skill) for THE TEAM CODE PREVIEW (backlog #150): TeamCodePreview through
// the real seam — team_service's team read and code-holder check, product_service's example and id reads, inventory's
// placements (StockSitsAmong over the moving ids), team_service naming the warehouses. A read the confirm WAITS on, so
// its wall time is what a person sees between Save and the four lines.
//
// The seed is TeamCodeUpdate's (product_code_recomposer_perf_test.go perfTcSeed): 150 000 background products in five
// other teams (half on a shelf), a team of 5 000 and a team of 50 000 (10 % archived), 75 % of each holding units in
// warehouse A, 15 % in B too. Each team previewed twice (cold, then warm); the statement count must not move with the
// products; the 50 000 preview's SELECTs EXPLAINed.
//
//	go test -tags perfaudit -p 1 -count=1 -timeout 15m -run 'TestPerf_TeamCodePreview' -v ./backend/cmd/app_development/
package main

import (
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

func TestPerf_TeamCodePreview(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	small, big := perfTcSeed(t, db)

	// The two warehouses the seed shelves in, as teams, so the preview names them.
	for _, w := range []struct {
		id   uint64
		name string
	}{{perfTcWarehouseA, "Gudang Perf A"}, {perfTcWarehouseB, "Gudang Perf B"}} {
		row := team_service_models.Team{ID: w.id, Type: "warehouse", Name: w.name, TeamCode: "PRF-WH-" + w.name[len(w.name)-1:]}

		err := db.Session(&gorm.Session{Logger: logger.Discard}).Create(&row).Error
		if err != nil {
			t.Fatal(err)
		}
	}

	products := product_v1.NewService(db, nil, nil, NewProductStockNarrower(db), nil)
	teams := team_v1.NewService(db, nil, NewProductCodeRecomposer(products))

	statements := map[string]int{}

	for _, c := range []struct {
		name     string
		team     uint64
		to       string
		products uint32
	}{
		{"5 000 · cold", small, "PRF5-XYZ", 5_000},
		{"5 000 · warm", small, "PRF5-XYZ", 5_000},
		{"50 000 · cold", big, "PRF50-XYZ", 50_000},
		{"50 000 · warm", big, "PRF50-XYZ", 50_000},
	} {
		probe.Reset()

		var resp *connect.Response[teamv1.TeamCodePreviewResponse]

		wall, inDB := probe.Measure(func() {
			var err error

			resp, err = teams.TeamCodePreview(asOwnerOf(c.team), connect.NewRequest(&teamv1.TeamCodePreviewRequest{TeamId: c.team, TeamCode: c.to}))
			if err != nil {
				t.Fatalf("%s: %v", c.name, err)
			}
		})

		got := resp.Msg
		if got.GetProducts() != c.products || len(got.GetWarehouseNames()) != 2 {
			t.Fatalf("%s: %d products, warehouses %v — want %d and both", c.name, got.GetProducts(), got.GetWarehouseNames(), c.products)
		}

		t.Logf("%s: wall %s, db %s, %d queries — %d products, %s → %s, %v", c.name, wall.Round(time.Millisecond),
			inDB.Round(time.Millisecond), probe.Count(), got.GetProducts(), got.GetExampleOldCode(), got.GetExampleNewCode(),
			got.GetWarehouseNames())

		statements[c.name] = probe.Count()
		queries := probe.Queries()
		probe.Report(t, "TeamCodePreview "+c.name)

		if c.name == "50 000 · warm" {
			for _, q := range queries {
				sql := strings.TrimSpace(q.SQL)
				if !strings.HasPrefix(sql, "SELECT") {
					continue
				}

				san_perf.Explain(t, db, sql)
			}
		}

		if wall > 200*time.Millisecond {
			t.Logf("🟡 SLOW: %s took %s — the confirm waits on it", c.name, wall.Round(time.Millisecond))
		}
	}

	first := statements["5 000 · cold"]
	for name, count := range statements {
		if count != first {
			t.Errorf("%s ran %d statements, the 5 000 cold %d — the count moved with the products (a loop?)", name, count, first)
		}
	}
}
