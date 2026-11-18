//go:build perfaudit

package inventory_v1_test

import (
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// perfRackStatWarehouse is the dense warehouse of the rack-figures probe — off the other probes' warehouses.
const perfRackStatWarehouse uint64 = 79

// THE RACK LIST'S FIGURES AT VOLUME (the-rack-list-leads-with-its-figures). One warehouse with 10 000 racks (an entity
// table at the audit's volume) and 50 000 shelf rows on them — 30 000 holding units, 20 000 a product that left (rows at
// 0), a rack in five empty — beside 20 more warehouses of 1 000 racks and 2 500 shelf rows each. RackStat is timed over
// the whole list, under a search that keeps a tenth of it, and one that keeps nothing; RackList's page of 20 with its
// STOCK slice is timed beside it as the read the screen already makes.
func TestPerf_RackStat(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		// the dense warehouse: 10 000 racks
		`INSERT INTO placements (warehouse_id, code, name, description)
		 SELECT 79, 'r-' || lpad(g::text, 5, '0'), 'perf rack ' || g, 'perf-rack-stat' FROM generate_series(1, 10000) g`,
		// 50 000 shelf rows: 5 per rack on 8 000 racks (2 000 racks hold nothing), 3 of the 5 with units
		`INSERT INTO product_placements (team_id, warehouse_id, product_id, placement_id, stock_count)
		 SELECT 2, 79, 500000 + k, p.id, CASE WHEN k < 3 THEN 1 + (p.id + k) % 40 ELSE 0 END
		 FROM placements p CROSS JOIN generate_series(0, 4) AS k
		 WHERE p.description = 'perf-rack-stat' AND p.id % 5 <> 0`,
		// the background: 20 warehouses × 1 000 racks, 2 500 rows each
		`INSERT INTO placements (warehouse_id, code, name, description)
		 SELECT 900 + w, 'b-' || lpad(g::text, 4, '0'), '', 'perf-rack-stat-bg'
		 FROM generate_series(1, 20) w CROSS JOIN generate_series(1, 1000) g`,
		`INSERT INTO product_placements (team_id, warehouse_id, product_id, placement_id, stock_count)
		 SELECT 2, p.warehouse_id, 600000 + k, p.id, 3
		 FROM placements p CROSS JOIN generate_series(0, 4) AS k
		 WHERE p.description = 'perf-rack-stat-bg' AND p.id % 2 = 0`,
	}

	for i, statement := range statements {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("seed %d: %v", i, err)
		}
	}

	for _, table := range []string{"placements", "product_placements"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}

	svc := newService(t, db)

	perfRackStatRuns(t, db, probe, svc, "without a new index")

	// THE CANDIDATE PURE INDEX, measured on the same seed: the warehouse's shelf rows holding units, by rack, the count
	// carried in the index.
	err := quiet.Exec(`CREATE INDEX perf_product_placements_held_idx ON product_placements (warehouse_id, placement_id)
		INCLUDE (stock_count) WHERE stock_count > 0`).Error
	if err != nil {
		t.Fatalf("candidate index: %v", err)
	}

	err = quiet.Exec("ANALYZE product_placements").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	perfRackStatRuns(t, db, probe, svc, "WITH the candidate index")
}

func perfRackStatRuns(t *testing.T, db *gorm.DB, probe *san_perf.Probe, svc *inventory_v1.Service, label string) {
	ctx := ctxUser(7)

	for _, c := range []struct {
		warehouse uint64
		q         string
	}{
		{perfRackStatWarehouse, ""},
		{perfRackStatWarehouse, "r-01"},
		{perfRackStatWarehouse, "nothing-here"},
		{901, ""},
	} {
		q := c.q
		req := &inventoryv1.RackStatRequest{TeamId: c.warehouse, Filter: &inventoryv1.RackListFilter{Q: q}}

		res, err := svc.RackStat(ctx, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("q %q warm-up: %v", q, err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				_, err = svc.RackStat(ctx, connect.NewRequest(req))
			})
			if err != nil {
				t.Fatalf("q %q: %v", q, err)
			}

			walls = append(walls, wall)
			t.Logf("%s: RackStat w=%d q=%q wall=%v db=%v queries=%d", label, c.warehouse, q, wall, dbTime, probe.Count())
		}

		t.Logf("%s: RackStat w=%d q=%q MEDIAN wall %v — %+v", label, c.warehouse, q, san_perf.Median(walls), res.Msg.GetPreview())

		for _, query := range probe.Queries() {
			if strings.HasPrefix(query.SQL, "SAVEPOINT") || strings.HasPrefix(query.SQL, "RELEASE") {
				continue
			}

			san_perf.Explain(t, db, query.SQL)
		}
	}

	if label != "without a new index" {
		return
	}

	// The read the screen already makes, for scale.
	list := &inventoryv1.RackListRequest{
		TeamId: perfRackStatWarehouse,
		DataRequest: []inventoryv1.RackListDataType{
			inventoryv1.RackListDataType_RACK_LIST_DATA_TYPE_RACK,
			inventoryv1.RackListDataType_RACK_LIST_DATA_TYPE_STOCK,
		},
		Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
	}

	_, err := svc.RackList(ctx, connect.NewRequest(list))
	if err != nil {
		t.Fatalf("RackList warm-up: %v", err)
	}

	walls := make([]time.Duration, 0, 5)

	for range 5 {
		probe.Reset()

		wall, _ := probe.Measure(func() {
			_, err = svc.RackList(ctx, connect.NewRequest(list))
		})
		if err != nil {
			t.Fatalf("RackList: %v", err)
		}

		walls = append(walls, wall)
	}

	t.Logf("RackList page 20 + STOCK (control) MEDIAN wall %v, queries=%d", san_perf.Median(walls), probe.Count())
}
