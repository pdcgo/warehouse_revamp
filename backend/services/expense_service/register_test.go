package expense_service_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1/expensev1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// THE ANALYTIC EXPENSE METRICS ARE MOUNTED (expense-has-ads-and-expenses): a handler unit test calls the handler
// directly, so an unmounted ExpenseAnalyticService would pass every one while the screen read 404. Through the REAL mux:
// the route answers, and reflection names it.
func TestRegister_TheExpenseMetricsAnswer(t *testing.T) {
	db := san_testdb.DB(t)
	mux := http.NewServeMux()

	names := expense_service.NewRegister(mux, expense_v1.NewService(db, nil, nil, nil, nil), connect.WithInterceptors())()
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

// THE CAPITAL LISTENER IS MOUNTED: `san pubsub ensure` declares expense-financial-account-capital-recorded, so the
// service must serve /event/<sub>/push — an unmounted route passes every handler test while the running app dead-letters
// every Setor / Tarik Modal. Through the REAL mux, as the emulator calls it: a selling team's Setor Modal becomes one
// Biaya row (the test's sides answer every team as a seller), and a redelivery is acked without a second.
func TestRegister_TheAccountPagesCapitalReachesBiaya(t *testing.T) {
	db := san_testdb.DB(t)
	mux := http.NewServeMux()
	expense_service.NewRegister(mux, expense_v1.NewService(db, nil, nil, nil, nil), connect.WithInterceptors())()

	event := &eventsv1.Event{
		EventId:     "financial-account-capital:9401",
		OccurredAt:  timestamppb.Now(),
		AggregateId: "financial-account:9402",
		Message: &eventsv1.Event_FinancialAccountCapitalRecorded{FinancialAccountCapitalRecorded: &eventsv1.FinancialAccountCapitalRecorded{
			LogId: 9_401, TeamId: 9_403, AccountId: 9_402, Change: 250_000, OccurredOn: "2026-11-10", ActorId: 61,
		}},
	}

	push(t, mux, event)
	push(t, mux, event)

	var rows []expense_service_models.ExpenseRecord

	err := db.
		Where("team_id = ?", 9_403).
		Find(&rows).
		Error
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	if len(rows) != 1 || rows[0].AccountLogID != 9_401 || rows[0].Origin != int32(expensev1.ExpenseOrigin_EXPENSE_ORIGIN_ACCOUNT_PAGE) {
		t.Fatalf("Biaya holds %+v — want one Setoran modal from the account page", rows)
	}
}

// push POSTs one event to the capital listener's route the way Pub/Sub's push does, and requires a 2xx (an ACK).
func push(t *testing.T, mux *http.ServeMux, event *eventsv1.Event) {
	t.Helper()

	data, err := protojson.Marshal(event)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	sub := expense_service.CapitalRecordedSubscription

	body, err := json.Marshal(event_source.PushRequest{
		Subscription: "projects/p/subscriptions/" + sub,
		Message:      event_source.PushMessage{Data: data, MessageID: event.GetEventId()},
	})
	if err != nil {
		t.Fatalf("marshal push: %v", err)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/event/"+sub+"/push", strings.NewReader(string(body))))

	if rec.Code/100 != 2 {
		t.Fatalf("push to %s = %d %q, want an ACK", sub, rec.Code, rec.Body.String())
	}
}
