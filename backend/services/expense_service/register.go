package expense_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1/expensev1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// CapitalRecordedSubscription is the push subscription that brings the account page's Setor / Tarik Modal to Biaya —
// a selling team's is recorded as the same one record, Setoran modal / Prive (prive-and-deposit-on-pengeluaran-are-the-
// accounts-capital; expense_v1/capital_from_account.go). Declared beside the route that serves it; tools/san's `pubsub
// ensure` creates it with an event_type filter, which is immutable once made.
const CapitalRecordedSubscription = "expense-financial-account-capital-recorded"

// NewRegister mounts ExpenseService and ExpenseAnalyticService (the Analytic expense metrics, served by the same
// handlers from the same records) and the capital listener's push route, and returns the proto service names they
// expose, so mounting and gRPC reflection come from the same call and cannot drift apart.
func NewRegister(
	mux *http.ServeMux,
	cost *expense_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(expensev1connect.NewExpenseServiceHandler(cost, opts))
		mux.Handle(expensev1connect.NewExpenseAnalyticServiceHandler(cost, opts))

		// THE LISTENER — /event/<sub_id>/push. A plain HTTP route, not a Connect RPC, so the roling ACL does not reach
		// it: it is the broker's door, restricted at the ingress like every other listener's.
		mux.Handle("/event/"+CapitalRecordedSubscription+"/push", event_source.NewMuxPushHandler(cost.CapitalFromAccountHandler()))

		return san_grpc.ServiceReflectNames{
			expensev1connect.ExpenseServiceName,
			expensev1connect.ExpenseAnalyticServiceName,
		}
	}
}
