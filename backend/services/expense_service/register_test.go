package expense_service_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1/expensev1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// THE ANALYTIC EXPENSE METRICS ARE MOUNTED (expense-has-ads-and-expenses): a handler unit test calls the handler
// directly, so an unmounted ExpenseAnalyticService would pass every one while the screen read 404. Through the REAL mux:
// the route answers, and reflection names it.
func TestRegister_TheExpenseMetricsAnswer(t *testing.T) {
	db := san_testdb.DB(t)
	mux := http.NewServeMux()

	names := expense_service.NewRegister(mux, expense_v1.NewService(db, nil, nil, nil), connect.WithInterceptors())()
	if !slices.Contains(names, expensev1connect.ExpenseAnalyticServiceName) {
		t.Fatalf("reflection names %v, want %s too", names, expensev1connect.ExpenseAnalyticServiceName)
	}

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	client := expensev1connect.NewExpenseAnalyticServiceClient(srv.Client(), srv.URL)

	res, err := client.MetricData(context.Background(), connect.NewRequest(&expensev1.MetricDataRequest{
		TeamId:  2,
		GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY,
		Filters: []*analytic_basev1.FilterItem{{F: &analytic_basev1.FilterItem_DateRangeFilter{
			DateRangeFilter: &analytic_basev1.DateRangeFilter{DateMin: "2026-10-01", DateMax: "2026-10-31"},
		}}},
		MetricIds: []string{"metrics/ads", "metrics/expenses"},
	}))
	if err != nil {
		t.Fatalf("MetricData through the mux: %v", err)
	}

	if got := len(res.Msg.GetMetricDatas()); got != 2 {
		t.Fatalf("%d answers, want one per metric", got)
	}
}
