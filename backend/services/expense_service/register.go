package expense_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1/expensev1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// NewRegister mounts ExpenseService and ExpenseAnalyticService (the Analytic expense metrics, served by the same
// handlers from the same records) and returns the proto service names they expose, so mounting and gRPC reflection come
// from the same call and cannot drift apart.
func NewRegister(
	mux *http.ServeMux,
	cost *expense_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(expensev1connect.NewExpenseServiceHandler(cost, opts))
		mux.Handle(expensev1connect.NewExpenseAnalyticServiceHandler(cost, opts))

		return san_grpc.ServiceReflectNames{
			expensev1connect.ExpenseServiceName,
			expensev1connect.ExpenseAnalyticServiceName,
		}
	}
}
