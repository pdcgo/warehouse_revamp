//go:build perfaudit

// Performance audit for the stock count (the audit-rpc-performance skill): the finalize at 1 and 20 products, and the
// growing reads — the session list, the watch page's rows, the rack list, one rack, the finalize review — against the
// ledgers' background volume plus a register and a history of counts.
//
//	go test -tags perfaudit -run TestPerf_Opname -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
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

// perfOpnameBackground adds, over the ledgers' background (perfLedgerBackground):
//
//	opname_sessions             1 000   finished, over the 20 warehouses
//	opname_session_snapshots   50 000   released rows of those counts
//	warehouse_stock_problems   50 000   one per background batch, half of them open losses
func perfOpnameBackground(t *testing.T, db *gorm.DB) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	for _, statement := range []string{
		`INSERT INTO opname_sessions (warehouse_id, status, plan, created_by_id, finalized_by_id, finalized_at)
		 SELECT 1 + g % 20, 'finish', 'all', 1, 2, NOW() FROM generate_series(1, 1000) g`,

		`INSERT INTO opname_session_snapshots (warehouse_id, team_id, product_id, placement_id, opname_session_id, status,
		     system_stock_count, recounted_stock_count, counted_by_id, released_at, product_code, product_name)
		 SELECT pp.warehouse_id, pp.team_id, pp.product_id, pp.placement_id, s.id, 'counted', pp.stock_count, pp.stock_count,
		        1, NOW(), 'BG', 'background'
		 FROM opname_sessions s
		 JOIN product_placements pp ON pp.warehouse_id = s.warehouse_id AND pp.id % 10 = s.id % 10`,

		`INSERT INTO warehouse_stock_problems (warehouse_id, team_id, product_id, transaction_id, batch_id, problem_type,
		     problem_stock_count, price_unit, claimable_stock_count, claimed_stock_count)
		 SELECT b.warehouse_id, b.team_id, b.product_id, b.transaction_id, b.id,
		        CASE WHEN b.id % 2 = 0 THEN 'lost' ELSE 'broken' END, 1, 1000,
		        CASE WHEN b.id % 2 = 0 THEN 1 ELSE 0 END, 0
		 FROM batches b JOIN inventory_transactions t ON t.id = b.transaction_id AND t.description = 'perf-bg'`,
	} {
		err := quiet.Exec(statement).Error
		if err != nil {
			t.Fatalf("opname background: %v\n%s", err, statement)
		}
	}

	for _, table := range []string{"opname_sessions", "opname_session_snapshots", "warehouse_stock_problems"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}
}

// perfCounted counts every row of a session the way a real count leaves it, in SQL (not what is measured): each target
// product short on its first rack with one torn unit, over on its second, exact on its third — an even product nets
// short (lost 1), an odd one over (found 2) — every draft with its reason.
func perfCounted(t *testing.T, db *gorm.DB, sessionID uint64, racks []uint64) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	steps := []struct {
		sql  string
		args []any
	}{
		{`UPDATE opname_session_snapshots SET status = 'counted', counted_by_id = 41,
		     recounted_stock_count = system_stock_count + CASE
		         WHEN placement_id = ? THEN CASE WHEN product_id % 2 = 0 THEN -3 ELSE -1 END
		         WHEN placement_id = ? THEN CASE WHEN product_id % 2 = 0 THEN 1 ELSE 2 END
		         ELSE 0 END
		 WHERE opname_session_id = ?`, []any{racks[0], racks[1], sessionID}},
		{`INSERT INTO opname_problems_drafts (warehouse_id, team_id, product_id, placement_id, opname_session_id, note,
		     problem_type, problem_stock_count)
		 SELECT warehouse_id, team_id, product_id, placement_id, opname_session_id, 'torn', 'broken', 1
		 FROM opname_session_snapshots WHERE opname_session_id = ? AND placement_id = ?`, []any{sessionID, racks[0]}},
		{`INSERT INTO opname_problems_drafts (warehouse_id, team_id, product_id, placement_id, opname_session_id, note,
		     problem_type, problem_stock_count)
		 SELECT warehouse_id, team_id, product_id, placement_id, opname_session_id, 'gone', 'lost', 2
		 FROM opname_session_snapshots WHERE opname_session_id = ? AND placement_id = ? AND product_id % 2 = 0`,
			[]any{sessionID, racks[0]}},
		{`INSERT INTO opname_surplus_drafts (warehouse_id, team_id, product_id, placement_id, opname_session_id, note,
		     surplus_stock_count)
		 SELECT warehouse_id, team_id, product_id, placement_id, opname_session_id, 'behind',
		        recounted_stock_count - system_stock_count
		 FROM opname_session_snapshots WHERE opname_session_id = ? AND placement_id = ?`, []any{sessionID, racks[1]}},
	}

	for _, step := range steps {
		err := quiet.Exec(step.sql, step.args...).Error
		if err != nil {
			t.Fatalf("count the session: %v", err)
		}
	}
}

// THE FINALIZE, at 1 product and at 20, each on three racks: the statements must not move with the products.
func TestPerf_OpnameSessionFinalize(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)
	perfOpnameBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20), nil)
	racks := []uint64{
		newRack(t, svc, otWarehouse, "perf-1"), newRack(t, svc, otWarehouse, "perf-2"), newRack(t, svc, otWarehouse, "perf-3"),
	}
	perfStock(t, db, otWarehouse, 20, 3, 100, racks)

	counts := map[int]int{}

	for _, size := range []int{1, 20} {
		walls := make([]time.Duration, 0, 5)

		for run := 0; run <= 5; run++ {
			// One product: a product count. Twenty: a count of perf-1, which every target product sits on — each joins
			// with its three racks (a-rack-plan-counts-its-products-everywhere).
			req := &inventoryv1.OpnameSessionCreateRequest{
				TeamId: otWarehouse, Plan: inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, FilterProductId: perfFirstProduct,
			}
			if size > 1 {
				req = &inventoryv1.OpnameSessionCreateRequest{
					TeamId: otWarehouse, Plan: inventoryv1.OpnamePlan_OPNAME_PLAN_PLACEMENT, FilterPlacementId: racks[0],
				}
			}

			created, err := svc.OpnameSessionCreate(opAdmin(opBudi), connect.NewRequest(req))
			if err != nil {
				t.Fatalf("plan (size %d, run %d): %v", size, run, err)
			}

			sessionID := created.Msg.GetSession().GetId()
			perfCounted(t, db, sessionID, racks)

			probe.Reset()

			var callErr error

			wall, dbTime := probe.Measure(func() {
				_, callErr = svc.OpnameSessionFinalize(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameSessionFinalizeRequest{
					TeamId: otWarehouse, SessionId: sessionID,
				}))
			})
			if callErr != nil {
				t.Fatalf("finalize (size %d, run %d): %v", size, run, callErr)
			}

			if run == 0 {
				continue // warm-up
			}

			walls = append(walls, wall)
			t.Logf("OpnameSessionFinalize products=%d wall=%v db=%v go=%v queries=%d", size, wall, dbTime, wall-dbTime, probe.Count())
		}

		t.Logf("OpnameSessionFinalize products=%d MEDIAN wall %v", size, san_perf.Median(walls))
		counts[size] = probe.Count()
		probe.Report(t, "OpnameSessionFinalize")
	}

	t.Logf("OpnameSessionFinalize queries: 1 product=%d, 20 products=%d", counts[1], counts[20])
}

// THE READS over a whole-warehouse count of Gudang 5 (its ~500 background shelf rows and the targets), beside 1 000
// finished counts and 50 000 released rows.
func TestPerf_OpnameReads(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)
	perfOpnameBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20), nil)
	racks := []uint64{newRack(t, svc, otWarehouse, "perf-1"), newRack(t, svc, otWarehouse, "perf-2")}
	perfStock(t, db, otWarehouse, 20, 2, 100, racks)

	created, err := svc.OpnameSessionCreate(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameSessionCreateRequest{
		TeamId: otWarehouse, Plan: inventoryv1.OpnamePlan_OPNAME_PLAN_ALL,
	}))
	if err != nil {
		t.Fatalf("plan: %v", err)
	}

	sessionID := created.Msg.GetSession().GetId()
	t.Logf("the all count holds %d rows on %d racks", created.Msg.GetSession().GetRowCount(), created.Msg.GetSession().GetRackCount())

	reads := []struct {
		name string
		call func(int) error
	}{
		{"OpnameSessionList", func(int) error {
			_, callErr := svc.OpnameSessionList(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameSessionListRequest{
				TeamId: otWarehouse, Filter: &inventoryv1.OpnameSessionListFilter{}, Page: page1(),
			}))

			return callErr
		}},
		{"OpnameRowList", func(int) error {
			_, callErr := svc.OpnameRowList(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameRowListRequest{
				TeamId: otWarehouse, Filter: &inventoryv1.OpnameRowListFilter{SessionId: sessionID}, Page: page1(),
			}))

			return callErr
		}},
		{"OpnameRowList q", func(int) error {
			_, callErr := svc.OpnameRowList(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameRowListRequest{
				TeamId: otWarehouse, Filter: &inventoryv1.OpnameRowListFilter{SessionId: sessionID, Q: "perf", OnlyDifferences: false},
				Page: page1(),
			}))

			return callErr
		}},
		{"OpnameRackList", func(int) error {
			_, callErr := svc.OpnameRackList(opStaff(opAni), connect.NewRequest(&inventoryv1.OpnameRackListRequest{
				TeamId: otWarehouse, Filter: &inventoryv1.OpnameRackListFilter{SessionId: sessionID}, Page: page1(),
			}))

			return callErr
		}},
		{"OpnameRackCount", func(int) error {
			_, callErr := svc.OpnameRackCount(opStaff(opAni), connect.NewRequest(&inventoryv1.OpnameRackCountRequest{
				TeamId: otWarehouse, SessionId: sessionID, PlacementId: racks[0],
			}))

			return callErr
		}},
		{"OpnameFinalizePreview", func(int) error {
			_, callErr := svc.OpnameFinalizePreview(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameFinalizePreviewRequest{
				TeamId: otWarehouse, SessionId: sessionID,
			}))

			return callErr
		}},
	}

	for _, r := range reads {
		perfRun(t, db, probe, r.name, 50, r.call)
	}
}
