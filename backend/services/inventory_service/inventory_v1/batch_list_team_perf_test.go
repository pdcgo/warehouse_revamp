//go:build perfaudit

package inventory_v1_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// perfTeamWarehouse is the dense warehouse of the team-filter probe — off the background's 1..20, the expiry probe's 77
// and the racks probe's 78.
const perfTeamWarehouse uint64 = 79

// The owners of the dense warehouse's batches: one team holds half of them, one a tenth, one a thousandth; the rest are
// spread over 40 more teams.
const (
	perfTeamBig   uint64 = 601
	perfTeamMid   uint64 = 602
	perfTeamSmall uint64 = 603
)

// THE BATCH LIST'S TEAM FILTER AT VOLUME (the-batch-list-filters-by-team). One warehouse holds 60 000 batches over four
// years, nine in ten emptied, owned by 43 selling teams — half one team's, a tenth another's, 60 batches a third's —
// beside the ledger background's 50 000 batches elsewhere. The handler is timed unfiltered and under each team at a
// page of 50, each statement explained; then the same cases again with a candidate index on (warehouse_id, team_id, id)
// built in the test's own transaction — a-pure-index-is-added-without-asking: kept only if it measures a gain.
func TestPerf_BatchList_OwnerTeam(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})
	perfLedgerBackground(t, db)

	statements := []string{
		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		 SELECT ?, 2, 'restock', 1, 'perf-team' FROM generate_series(1, 60000) g`,
		`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                      init_stock_count, init_stock_valuation, expired_at, created_at)
		 SELECT t.warehouse_id,
		        CASE WHEN t.id % 1000 = 7 THEN 603
		             WHEN t.id % 2 = 0 THEN 601
		             WHEN t.id % 10 IN (1, 3) THEN 602
		             ELSE 610 + t.id % 40 END,
		        500000 + t.id % 3000, t.id, 1000,
		        CASE WHEN t.id % 10 = 0 THEN 1 + t.id % 40 ELSE 0 END,
		        CASE WHEN t.id % 10 = 0 THEN (1 + t.id % 40) * 1000 ELSE 0 END,
		        40, 40000,
		        NOW() + ((t.id % 1461) - 730) * INTERVAL '1 day',
		        NOW() - (t.id % 1461) * INTERVAL '1 day'
		 FROM inventory_transactions t WHERE t.description = 'perf-team'`,
		// The background's restocks carry transaction 0, which makes the planner seq-scan restocks under the batch read's
		// join; a real restock names its own transaction (batch_detail_perf_test.go does the same).
		`UPDATE restocks SET transaction_id = id + 10000000 WHERE note = 'perf-bg'`,
	}

	for i, statement := range statements {
		var args []any
		if i == 0 {
			args = []any{perfTeamWarehouse}
		}

		err := quiet.Exec(statement, args...).Error
		if err != nil {
			t.Fatalf("team seed %d: %v", i, err)
		}
	}

	for _, table := range []string{"batches", "inventory_transactions", "restocks"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}

	var held []struct {
		TeamID uint64
		N      int64
	}

	err := quiet.
		Raw(`SELECT team_id, COUNT(*) AS n FROM batches WHERE warehouse_id = ? AND team_id IN (601, 602, 603) GROUP BY 1 ORDER BY 1`,
			perfTeamWarehouse).
		Scan(&held).
		Error
	if err != nil {
		t.Fatalf("held: %v", err)
	}

	t.Logf("seeded: %+v of 60 000 in warehouse %d", held, perfTeamWarehouse)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(1), nil, nil, nil, nil)

	cases := []struct {
		name   string
		filter *inventoryv1.BatchListFilter
		page   uint32
	}{
		{"unfiltered", nil, 1},
		{"team 601 (half)", &inventoryv1.BatchListFilter{OwnerTeamId: perfTeamBig}, 1},
		{"team 602 (a tenth)", &inventoryv1.BatchListFilter{OwnerTeamId: perfTeamMid}, 1},
		{"team 603 (60 batches)", &inventoryv1.BatchListFilter{OwnerTeamId: perfTeamSmall}, 1},
		{"team 602, page 40", &inventoryv1.BatchListFilter{OwnerTeamId: perfTeamMid}, 40},
		{"team 603 + Kedaluwarsa ≤ 30 hari", &inventoryv1.BatchListFilter{
			OwnerTeamId: perfTeamSmall,
			Expiry:      inventoryv1.BatchExpiryFilter_BATCH_EXPIRY_FILTER_EXPIRING_SOON,
		}, 1},
	}

	measure := func(label string) {
		for _, c := range cases {
			name := label + " · BatchList " + c.name + ", page 50"

			var last *connect.Response[inventoryv1.BatchListResponse]

			count := perfRun(t, db, probe, name, 50, func(int) error {
				var callErr error

				last, callErr = svc.BatchList(ctxUser(8), connect.NewRequest(&inventoryv1.BatchListRequest{
					TeamId: perfTeamWarehouse, Filter: c.filter, Page: &commonv1.CommonPagination{Page: c.page, Limit: 50},
				}))

				return callErr
			})

			t.Logf("%s: %d statements, %d rows of %d", name, count, len(last.Msg.GetIds()),
				last.Msg.GetPageInfo().GetTotalItems())

			// Every statement explained, not only the slowest: the count and the header figures read the whole filtered
			// set, the page reads its window.
			probe.Reset()

			_, callErr := svc.BatchList(ctxUser(8), connect.NewRequest(&inventoryv1.BatchListRequest{
				TeamId: perfTeamWarehouse, Filter: c.filter, Page: &commonv1.CommonPagination{Page: c.page, Limit: 50},
			}))
			if callErr != nil {
				t.Fatalf("%s: %v", name, callErr)
			}

			for _, q := range probe.Queries() {
				upper := strings.ToUpper(strings.TrimSpace(q.SQL))
				if !strings.HasPrefix(upper, "SELECT") {
					continue
				}

				san_perf.Explain(t, db, q.SQL)
			}
		}
	}

	measure("BEFORE")

	err = quiet.Exec(`CREATE INDEX perf_batches_wh_team_id_idx ON batches (warehouse_id, team_id, id)`).Error
	if err != nil {
		t.Fatalf("candidate index: %v", err)
	}

	err = quiet.Exec("ANALYZE batches").Error
	if err != nil {
		t.Fatalf("analyze batches: %v", err)
	}

	measure("WITH (warehouse_id, team_id, id)")
}
