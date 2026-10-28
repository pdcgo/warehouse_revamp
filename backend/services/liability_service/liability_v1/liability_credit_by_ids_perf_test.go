//go:build perfaudit

// Performance audit for LiabilityCreditByIds (the audit-rpc-performance skill).
//
// WHY THIS RPC. It is read on every order form, for every creditor on the order, and it reads the two tables that
// grow with the number of trading pairs. The design is two queries whatever the number of creditors; this proves it
// on a full table and plans both.
//
//	go test -tags perfaudit -run TestPerf_LiabilityCreditByIds -v ./backend/services/liability_service/liability_v1/
package liability_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

func TestPerf_LiabilityCreditByIds(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	svc := liability_v1.NewService(db, nil, nil, nil)
	ctx := context.Background()

	// 10 000 terms rows and 10 000 pairs of balances: 200 creditors × 50 debtors, plus every creditor's default row.
	// The asking team is one of the 50 debtors, so its rows are a 2% slice of each table.
	const creditors, debtors = 200, 50

	terms := make([]liability_service_models.LiabilityTerms, 0, creditors*(debtors+1))
	balances := make([]liability_service_models.LiabilityBalance, 0, creditors*debtors*2)

	for c := uint64(0); c < creditors; c++ {
		creditor := 5000 + c
		limit := int64(1_000_000)
		terms = append(terms, liability_service_models.LiabilityTerms{TeamID: creditor, CounterpartyID: 0, CreditLimit: &limit})

		for d := uint64(0); d < debtors; d++ {
			debtor := 100 + d
			pair := int64(500_000 + c)
			terms = append(terms, liability_service_models.LiabilityTerms{TeamID: creditor, CounterpartyID: debtor, CreditLimit: &pair})

			owed := int64(1000 * (c + d + 1))
			balances = append(balances,
				liability_service_models.LiabilityBalance{TeamID: debtor, CounterpartyID: creditor, Balance: -owed},
				liability_service_models.LiabilityBalance{TeamID: creditor, CounterpartyID: debtor, Balance: owed},
			)
		}
	}

	san_perf.SeedRows(t, db, terms)
	san_perf.SeedRows(t, db, balances)

	for _, size := range []int{5, 50} {
		ids := make([]uint64, 0, size)
		for i := 0; i < size; i++ {
			ids = append(ids, 5000+uint64(i*3))
		}

		req := &liabilityv1.LiabilityCreditByIdsRequest{
			TeamId: 120,
			Filter: &liabilityv1.LiabilityCreditByIdsFilter{Ids: ids},
		}

		// Warm-up: schema reflection and the pool are not the RPC's cost.
		_, err := svc.LiabilityCreditByIds(ctx, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("LiabilityCreditByIds: %v", err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				_, err = svc.LiabilityCreditByIds(ctx, connect.NewRequest(req))
			})
			if err != nil {
				t.Fatalf("LiabilityCreditByIds: %v", err)
			}

			walls = append(walls, wall)
			t.Logf("%d creditors: wall=%v db=%v go=%v queries=%d", size, wall, dbTime, wall-dbTime, probe.Count())
		}

		t.Logf("%d creditors: median wall %v", size, san_perf.Median(walls))

		// ⚠ THE COUNT MUST NOT MOVE WITH THE CREDITORS — that would be an N+1, heavy at any absolute number.
		if probe.Count() != 2 {
			t.Fatalf("%d queries for %d creditors, want 2", probe.Count(), size)
		}

		probe.Report(t, "LiabilityCreditByIds")

		for _, q := range probe.Queries() {
			san_perf.Explain(t, db, q.SQL)
		}
	}
}
