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

// perfRacksWarehouse is the dense warehouse of the racks probe — off the background's 1..20 and the expiry probe's 77.
const perfRacksWarehouse uint64 = 78

// THE BATCH LIST'S RACKS AT VOLUME (the-expiry-report-is-the-batch-list). One warehouse holds 60 000 batches of 3 000
// products over four years, nine in ten emptied, every one with an expiry; 600 racks; each product on 3 racks with units
// and on 3 more it has left (rack rows at 0) — 18 000 rack rows — beside the ledger background's 50 000 batches and
// 10 000 rack rows elsewhere. The handler is timed at a page of 50 and of 200, unfiltered and under *Kedaluwarsa ≤ 30
// hari*; the racks statement is timed alone and explained.
func TestPerf_BatchList_Racks(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})
	perfLedgerBackground(t, db)

	statements := []string{
		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		 SELECT ?, 2, 'restock', 1, 'perf-racks' FROM generate_series(1, 60000) g`,
		`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                      init_stock_count, init_stock_valuation, expired_at, created_at)
		 SELECT t.warehouse_id, 2, 400000 + t.id % 3000, t.id, 1000,
		        CASE WHEN t.id % 10 = 0 THEN 1 + t.id % 40 ELSE 0 END,
		        CASE WHEN t.id % 10 = 0 THEN (1 + t.id % 40) * 1000 ELSE 0 END,
		        40, 40000,
		        NOW() + ((t.id % 1461) - 730) * INTERVAL '1 day',
		        NOW() - (t.id % 1461) * INTERVAL '1 day'
		 FROM inventory_transactions t WHERE t.description = 'perf-racks'`,
		`INSERT INTO placements (warehouse_id, code, name, description)
		 SELECT ?, 'r-' || lpad(g::text, 3, '0'), 'perf rack', 'perf-racks' FROM generate_series(1, 600) g`,
		// each product on six racks: three with units, three it has left
		`INSERT INTO product_placements (team_id, warehouse_id, product_id, placement_id, stock_count)
		 SELECT 2, p.warehouse_id, 400000 + g.product, p.id, CASE WHEN k < 3 THEN 5 ELSE 0 END
		 FROM generate_series(0, 2999) AS g(product)
		 CROSS JOIN generate_series(0, 5) AS k
		 JOIN LATERAL (SELECT id, warehouse_id FROM placements WHERE description = 'perf-racks'
		               ORDER BY id OFFSET (g.product * 7 + k * 101) % 600 LIMIT 1) p ON TRUE`,
	}

	for i, statement := range statements {
		var args []any
		if i == 0 || i == 2 {
			args = []any{perfRacksWarehouse}
		}

		err := quiet.Exec(statement, args...).Error
		if err != nil {
			t.Fatalf("racks seed %d: %v", i, err)
		}
	}

	for _, table := range []string{"batches", "inventory_transactions", "placements", "product_placements"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(1), nil, nil)

	soon := &inventoryv1.BatchListFilter{Expiry: inventoryv1.BatchExpiryFilter_BATCH_EXPIRY_FILTER_EXPIRING_SOON}

	for _, c := range []struct {
		name   string
		filter *inventoryv1.BatchListFilter
		limit  uint32
	}{
		{"BatchList unfiltered, page 50", nil, 50},
		{"BatchList unfiltered, page 200", nil, 200},
		{"BatchList Kedaluwarsa ≤ 30 hari, page 50", soon, 50},
		{"BatchList Kedaluwarsa ≤ 30 hari, page 200", soon, 200},
	} {
		var last *connect.Response[inventoryv1.BatchListResponse]

		count := perfRun(t, db, probe, c.name, int(c.limit), func(int) error {
			var callErr error

			last, callErr = svc.BatchList(ctxUser(8), connect.NewRequest(&inventoryv1.BatchListRequest{
				TeamId: perfRacksWarehouse, Filter: c.filter, Page: &commonv1.CommonPagination{Page: 1, Limit: c.limit},
			}))

			return callErr
		})

		named := 0
		for _, b := range batchRows(last.Msg) {
			if len(b.GetRackCodes()) > 0 {
				named++
			}
		}

		t.Logf("%s: %d statements, %d of %d rows name racks", c.name, count, named, len(batchRows(last.Msg)))

		// The racks statement alone, timed and explained.
		probe.Reset()

		_, err := svc.BatchList(ctxUser(8), connect.NewRequest(&inventoryv1.BatchListRequest{
			TeamId: perfRacksWarehouse, Filter: c.filter, Page: &commonv1.CommonPagination{Page: 1, Limit: c.limit},
		}))
		if err != nil {
			t.Fatalf("BatchList: %v", err)
		}

		for _, q := range probe.Queries() {
			if !strings.Contains(q.SQL, "product_placements") {
				continue
			}

			var runs []time.Duration

			for range 5 {
				start := time.Now()

				err = quiet.Exec(q.SQL).Error
				if err != nil {
					t.Fatalf("racks statement: %v", err)
				}

				runs = append(runs, time.Since(start))
			}

			t.Logf("%s: the racks statement median %v", c.name, san_perf.Median(runs))
			san_perf.Explain(t, db, q.SQL)
		}
	}
}
