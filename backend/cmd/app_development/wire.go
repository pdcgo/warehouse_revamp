//go:build wireinject
// +build wireinject

package main

import (
	"github.com/google/wire"

	"github.com/pdcgo/warehouse_revamp/backend/services/hello_service"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service"
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
		NewRoleResolver,
		NewInternalHTTPClient,

		// Cross-service Connect clients. Reads are local queries; WRITES to another service's
		// table go through its RPC, so its invariants are not bypassed.
		NewUserClient,
		NewTeamClient,

		user_service.NewAuthService,
		user_service.NewService,
		team_service.NewService,
		hello_service.NewService,

		NewServeMux,
		NewServer,
		NewApp,
	)

	return nil, nil
}
