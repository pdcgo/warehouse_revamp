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

// TeamPaymentSubscription is the push subscription that brings liability's accepted team payments to the
// accounts (a-team-payment-posts-on-accept) — one row out of the payer's account, one into the creditor's.
// Declared with the same care as the withdrawal's: tools/san's `pubsub ensure` creates it with an event_type
// filter, which is immutable once made.
const TeamPaymentSubscription = "financial-account-team-payment"

// The push subscriptions that bring inventory's RESTOCK payments to the account that paid
// (a-created-restock-tells-the-financial-account, a-restock-names-its-paying-account, an-edit-sends-the-difference,
// an-edit-may-move-the-payment-to-another-account). One per topic, all three to the one listener; each created by
// tools/san's `pubsub ensure` with its event_type filter, which is immutable once made.
const (
	RestockCreatedSubscription   = "financial-account-restock-created"
	RestockUpdatedSubscription   = "financial-account-restock-updated"
	RestockCancelledSubscription = "financial-account-restock-cancelled"
)

// The push subscriptions that bring expense_service's EXPENSES to the account that paid
// (an-expense-must-name-the-account-that-paid, a-correction-follows-the-expenses-account) — the expense out, and each
// correction's signed difference. One per topic, both to the one listener; created by tools/san's `pubsub ensure` with
// their event_type filters, immutable once made.
const (
	ExpenseCreatedSubscription  = "financial-account-expense-created"
	ExpenseAdjustedSubscription = "financial-account-expense-adjusted"
)

// The push subscriptions that bring inventory's WAREHOUSE TRANSFER shipping cost to the selling team's account that
// paid (the-shipping-expense-reaches-the-account-by-event, a-transfers-shipping-posts-as-an-expense) — posted as
// `expense`. One per topic, all three to the one listener; each created by tools/san's `pubsub ensure` with its
// event_type filter, which is immutable once made.
const (
	WarehouseTransferCreatedSubscription   = "financial-account-warehouse-transfer-created"
	WarehouseTransferUpdatedSubscription   = "financial-account-warehouse-transfer-updated"
	WarehouseTransferCancelledSubscription = "financial-account-warehouse-transfer-cancelled"
)

// NewRegister mounts financial_account_service's Connect handlers under the shared interceptor chain, mounts
// the withdrawal, team-payment, restock-payment, expense-payment and transfer-shipping listeners' push routes, and reports the Connect services for reflection.
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
		mux.Handle("/event/"+TeamPaymentSubscription+"/push", event_source.NewMuxPushHandler(accounts.TeamPaymentHandler()))

		// The restock's payment, its edits and its refund — one listener, its three subscriptions.
		restock := event_source.NewMuxPushHandler(accounts.RestockPaymentHandler())
		mux.Handle("/event/"+RestockCreatedSubscription+"/push", restock)
		mux.Handle("/event/"+RestockUpdatedSubscription+"/push", restock)
		mux.Handle("/event/"+RestockCancelledSubscription+"/push", restock)

		// An expense paid from an account, and its corrections — one listener, its two subscriptions.
		expense := event_source.NewMuxPushHandler(accounts.ExpensePaymentHandler())
		mux.Handle("/event/"+ExpenseCreatedSubscription+"/push", expense)
		mux.Handle("/event/"+ExpenseAdjustedSubscription+"/push", expense)

		// A warehouse transfer's shipping, its edits and its refund — one listener, its three subscriptions.
		shipping := event_source.NewMuxPushHandler(accounts.TransferShippingHandler())
		mux.Handle("/event/"+WarehouseTransferCreatedSubscription+"/push", shipping)
		mux.Handle("/event/"+WarehouseTransferUpdatedSubscription+"/push", shipping)
		mux.Handle("/event/"+WarehouseTransferCancelledSubscription+"/push", shipping)

		return san_grpc.ServiceReflectNames{
			financial_accountv1connect.FinancialAccountServiceName,
			financial_accountv1connect.FinancialAccountAnalyticServiceName,
		}
	}
}
