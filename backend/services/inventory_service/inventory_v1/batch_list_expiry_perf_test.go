//go:build perfaudit

package inventory_v1_test

import (
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// perfExpiryWarehouse is the dense warehouse of the expiry probe — off the background's 1..20.
const perfExpiryWarehouse uint64 = 77

// THE BATCH LIST'S EXPIRING SOON, BEFORE AND AFTER "WITH UNITS LEFT" (expiry-is-a-report). One warehouse holds 60 000
// batches over four years, every one with an expiry (-2 .. +2 years) and nine in ten of them emptied — a busy
// building's history — beside the ledger background's 50 000 batches elsewhere. The handler is timed as it is now
// (the soon filter and the unfiltered strip), then each of its soon-filter statements is timed against the same
// statement with the OLD predicate (no `stock_count > 0`), old/new/new/old on this one seed.
func TestPerf_BatchList_ExpiringSoon(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})
	perfLedgerBackground(t, db)

	statements := []string{
		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		 SELECT ?, 2, 'restock', 1, 'perf-expiry' FROM generate_series(1, 60000) g`,
		`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                      init_stock_count, init_stock_valuation, expired_at, created_at)
		 SELECT t.warehouse_id, 2, 300000 + t.id % 3000, t.id, 1000,
		        CASE WHEN t.id % 10 = 0 THEN 1 + t.id % 40 ELSE 0 END,
		        CASE WHEN t.id % 10 = 0 THEN (1 + t.id % 40) * 1000 ELSE 0 END,
		        40, 40000,
		        NOW() + ((t.id % 1461) - 730) * INTERVAL '1 day',
		        NOW() - (t.id % 1461) * INTERVAL '1 day'
		 FROM inventory_transactions t WHERE t.description = 'perf-expiry'`,
	}

	for i, statement := range statements {
		var args []any
		if i == 0 {
			args = []any{perfExpiryWarehouse}
		}

		err := quiet.Exec(statement, args...).Error
		if err != nil {
			t.Fatalf("expiry seed: %v\n%s", err, statement)
		}
	}

	for _, table := range []string{"batches", "inventory_transactions"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(1), nil, nil)

	soonFilter := &inventoryv1.BatchListFilter{Expiry: inventoryv1.BatchExpiryFilter_BATCH_EXPIRY_FILTER_EXPIRING_SOON}

	var soon *connect.Response[inventoryv1.BatchListResponse]

	perfRun(t, db, probe, "BatchList expiring soon", 1, func(int) error {
		var callErr error

		soon, callErr = svc.BatchList(ctxUser(8), connect.NewRequest(&inventoryv1.BatchListRequest{
			TeamId: perfExpiryWarehouse, Filter: soonFilter, Page: page1(),
		}))

		return callErr
	})

	t.Logf("expiring soon: %d batches with units left, strip count %d", soon.Msg.GetPageInfo().GetTotalItems(),
		soon.Msg.GetExpiringSoonCount())

	// The SQL the soon filter issues, as GORM interpolated it — the old shape is the same text without the units test.
	probe.Reset()

	_, err := svc.BatchList(ctxUser(8), connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: perfExpiryWarehouse, Filter: soonFilter, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}

	soonStatements := probe.Queries()

	perfRun(t, db, probe, "BatchList unfiltered (the strip)", 1, func(int) error {
		_, callErr := svc.BatchList(ctxUser(8), connect.NewRequest(&inventoryv1.BatchListRequest{
			TeamId: perfExpiryWarehouse, Page: page1(),
		}))

		return callErr
	})

	probe.Reset()

	_, err = svc.BatchList(ctxUser(8), connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: perfExpiryWarehouse, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}

	// The unfiltered list's statements carry the units test only inside the strip's count (its CASE).
	soonStatements = append(soonStatements, probe.Queries()...)

	const newPredicate = "b.stock_count > 0 AND b.expired_at IS NOT NULL AND b.expired_at <"
	const oldPredicate = "b.expired_at IS NOT NULL AND b.expired_at <"

	for i, q := range soonStatements {
		if !strings.Contains(q.SQL, newPredicate) {
			continue
		}

		oldSQL := strings.ReplaceAll(q.SQL, newPredicate, oldPredicate)

		var olds, news []time.Duration

		for _, order := range []string{"old", "new", "new", "old", "old", "new", "new", "old", "old", "new"} {
			sql := q.SQL
			if order == "old" {
				sql = oldSQL
			}

			start := time.Now()

			err = quiet.Exec(sql).Error
			if err != nil {
				t.Fatalf("statement %d (%s): %v", i, order, err)
			}

			if order == "old" {
				olds = append(olds, time.Since(start))
			} else {
				news = append(news, time.Since(start))
			}
		}

		t.Logf("statement %d: OLD median %v, NEW median %v — %s", i, san_perf.Median(olds), san_perf.Median(news), expiryProbeHead(q.SQL))
		san_perf.Explain(t, db, oldSQL)
		san_perf.Explain(t, db, q.SQL)
	}
}

func expiryProbeHead(sql string) string {
	sql = strings.Join(strings.Fields(sql), " ")
	if len(sql) > 90 {
		return sql[:90] + "…"
	}

	return sql
}
