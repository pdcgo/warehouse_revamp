//go:build perfaudit

// Performance audit for ExpensePersonList (the audit-rpc-performance skill): the Analytic "created by" field's feed over
// the expense metrics, against metric_perf_test.go's ~219 000 report rows — a year of days × 150 teams × kinds × people.
//
//	go test -tags perfaudit -p 1 -run TestPerf_ExpensePersonList -v ./backend/services/expense_service/expense_v1/
package expense_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The picker's first page (200), for a seller, for Ads expense alone, and for the root team, which reads every team's.
func TestPerf_ExpensePersonList(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfMetricBackground(t, db)

	svc := newService(t, db)
	ctx := t.Context()

	const seller uint64 = 140

	list := func(team uint64, metrics ...string) func() error {
		return func() error {
			res, err := svc.ExpensePersonList(ctx, connect.NewRequest(&expensev1.ExpensePersonListRequest{
				TeamId: team,
				Filter: &expensev1.ExpensePersonListFilter{MetricIds: metrics},
				Page:   &commonv1.CommonPagination{Page: 1, Limit: 200},
			}))
			if err == nil && len(res.Msg.GetIds()) == 0 {
				t.Fatalf("team %d %v: nobody listed", team, metrics)
			}

			return err
		}
	}

	perfMetricRun(t, db, probe, "ExpensePersonList seller", list(seller))
	perfMetricRun(t, db, probe, "ExpensePersonList seller ads", list(seller, metricAds))
	perfMetricRun(t, db, probe, "ExpensePersonList root", list(san_auth.RootTeamID))
	perfMetricRun(t, db, probe, "ExpensePersonList root ads", list(san_auth.RootTeamID, metricAds))
}
