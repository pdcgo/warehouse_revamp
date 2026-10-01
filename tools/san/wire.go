//go:build wireinject
// +build wireinject

package main

import (
	"github.com/google/wire"

	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
)

// InitializeSan is the operations tool's composition root. Regenerate after changing it:
//
//	go tool wire ./tools/san
//
// The DSN is a PARAMETER, not a provider: the operator picks the database per invocation (see
// withSan), and everything downstream — the pool, the resolver, the service — is built for that
// choice.
func InitializeSan(dsn DatabaseDSN) (*San, error) {
	wire.Build(
		NewConfig,
		NewDatabase,
		NewCache,
		NewSigner,
		NewRoleResolver,
		NewInternalHTTPClient,
		NewTeamClient,

		user_v1.NewService,

		NewSan,
	)

	return nil, nil
}
