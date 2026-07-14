//go:build wireinject
// +build wireinject

package main

import (
	"github.com/google/wire"

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
		NewRoleResolver,
		NewInternalHTTPClient,

		// Cross-service Connect clients. Reads are local queries; WRITES to another service's
		// table go through its RPC, so its invariants are not bypassed.
		NewUserClient,
		NewTeamClient,

		user_v1.NewAuthService,
		user_v1.NewService,
		team_v1.NewService,

		NewServeMux,
		NewServer,
		NewApp,
	)

	return nil, nil
}
