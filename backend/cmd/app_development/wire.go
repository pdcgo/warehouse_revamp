//go:build wireinject
// +build wireinject

package main

import (
	"github.com/google/wire"

	category_v1 "github.com/pdcgo/warehouse_revamp/backend/services/category_service/category_v1"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
	document_v1 "github.com/pdcgo/warehouse_revamp/backend/services/document_service/document_v1"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
	region_v1 "github.com/pdcgo/warehouse_revamp/backend/services/region_service/region_v1"
	revenue_v1 "github.com/pdcgo/warehouse_revamp/backend/services/revenue_service/revenue_v1"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	shipping_v1 "github.com/pdcgo/warehouse_revamp/backend/services/shipping_service/shipping_v1"
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
		shipping_v1.NewService,
		product_v1.NewService,
		selling_v1.NewService,
		// Joins selling to inventory (#149/#70) — see stock_picker.go.
		NewStockPicker,
		NewProductCatalog,
		// Where OrderPlacedEvent goes (#153) — see event_sender.go.
		NewEventSender,
		category_v1.NewService,
		document_v1.NewService,
		inventory_v1.NewService,
		region_v1.NewService,
		revenue_v1.NewService,
		expense_v1.NewService,

		NewServeMux,
		NewServer,
		NewApp,
	)

	return nil, nil
}
