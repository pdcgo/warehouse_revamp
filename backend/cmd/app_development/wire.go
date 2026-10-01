//go:build wireinject
// +build wireinject

package main

import (
	"github.com/google/wire"

	category_v1 "github.com/pdcgo/warehouse_revamp/backend/services/category_service/category_v1"
	document_v1 "github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
	region_v1 "github.com/pdcgo/warehouse_revamp/backend/services/region_service/region_v1"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	settlement_importer_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_v1"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
	shipment_v1 "github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_v1"
	team_v1 "github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
)

// InitializeApp is the composition root. Regenerate after changing it:
//
//	cd backend && go tool wire ./cmd/app_development
func InitializeApp() (*App, error) {
	wire.Build(
		NewConfig,
		NewDatabase,
		NewCache,
		NewSigner,
		NewOtp,
		NewDocumentConfig,
		NewRoleResolver,
		NewInternalHTTPClient,

		// Cross-service Connect clients. Reads are local queries; WRITES to another service's
		// table go through its RPC, so its invariants are not bypassed.
		NewUserClient,
		NewTeamClient,

		user_v1.NewAuthService,
		user_v1.NewService,
		team_v1.NewService,
		shipment_v1.NewService,
		product_v1.NewService,
		selling_v1.NewService,
		// Whether a user runs a team, for ShopAccessCheck — see role_reader.go.
		NewRoleReader,
		// Joins selling to inventory (#149/#70) — see stock_picker.go.
		NewStockPicker,
		NewProductCatalog,
		// Where the order events go (#153) — see event_sender.go. Dev publishes to the local
		// EMULATOR, not an in-process loopback (dev-runs-the-emulator).
		NewPubsubClient,
		NewEventSender,
		category_v1.NewService,
		document_v1.NewService,
		inventory_v1.NewService,
		liability_v1.NewService,
		settlement_v1.NewService,
		// Who an imported shop row counts for — the shop's primary CS, asked over Connect under the
		// caller's token. See shop_primary.go.
		NewShopClient,
		NewShopPrimary,
		// Joins selling to settlement — an order opens and cancels its marketplace account. See
		// settlement_poster.go.
		NewSettlementPoster,
		// The subscription settlement's replay seeks — see replay_broker.go.
		NewReplayBroker,
		// The settlement importer, and its four services as clients under the uploader's token — see
		// settlement_importer_deps.go.
		settlement_importer_v1.NewService,
		NewOrderClient,
		NewDocumentClient,
		NewSettlementWriteClient,
		NewImporterShopChecker,
		NewImporterOrderFinder,
		NewImporterStatementStore,
		NewImporterLedger,
		// Joins inventory to liability (#184) — see liability_poster.go.
		NewLiabilityPoster,
		NewCreditChecker,
		region_v1.NewService,
		expense_v1.NewService,
		// Joins inventory to expense (#211) — writing off the value of damaged/lost stock. See
		// expense_poster.go.
		NewExpensePoster,
		// The money a team holds — its accounts, their logs, the withdrawal listener. Its one outside question,
		// whether a shop is the team's, is asked of the shop — see financial_account_deps.go.
		financial_account_v1.NewService,
		NewFinancialAccountShopChecker,

		NewServeMux,
		NewServer,
		NewApp,
	)

	return nil, nil
}
