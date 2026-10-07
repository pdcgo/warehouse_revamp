package expense_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1/expensev1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// NewRegister mounts ExpenseService and returns the proto service names it exposes, so mounting and
// gRPC reflection come from the same call and cannot drift apart.
func NewRegister(
	mux *http.ServeMux,
	cost *expense_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(expensev1connect.NewExpenseServiceHandler(cost, opts))

		return san_grpc.ServiceReflectNames{
			expensev1connect.ExpenseServiceName,
		}
	}
}
