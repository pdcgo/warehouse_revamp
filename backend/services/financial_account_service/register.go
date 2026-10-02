package financial_account_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1/financial_accountv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// WithdrawalSubscription is the push subscription that brings settlement's `withdrawal` rows to the accounts
// (revenue-stays-in-settlement).
//
// Declared beside the route that serves it (one-adopter-checklist-for-both-drivers). tools/san's `pubsub
// ensure` declares the same id, with a filter on event_type — a subscription's filter is IMMUTABLE, so it has
// to be right at creation. A DIFFERENT subscription from settlement's own fold on the same topic: each has its
// own delivery state, so the accounts falling behind never delays a report, and vice versa.
const WithdrawalSubscription = "financial-account-withdrawal"

// NewRegister mounts financial_account_service's Connect handlers under the shared interceptor chain, mounts
// the withdrawal listener's push route, and reports the Connect services for reflection.
func NewRegister(
	mux *http.ServeMux,
	accounts *financial_account_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(financial_accountv1connect.NewFinancialAccountServiceHandler(accounts, opts))
		mux.Handle(financial_accountv1connect.NewFinancialAccountAnalyticServiceHandler(accounts, opts))

		// THE LISTENER — /event/<sub_id>/push. A plain HTTP route, not a Connect RPC, so the roling ACL does not
		// reach it: it is the broker's door, restricted at the ingress like settlement's fold.
		mux.Handle("/event/"+WithdrawalSubscription+"/push", event_source.NewMuxPushHandler(accounts.WithdrawalHandler()))

		return san_grpc.ServiceReflectNames{
			financial_accountv1connect.FinancialAccountServiceName,
			financial_accountv1connect.FinancialAccountAnalyticServiceName,
		}
	}
}
