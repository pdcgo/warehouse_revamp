//go:build wireinject
// +build wireinject

package main

import (
	"github.com/google/wire"

	shipment_v1 "github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_v1"
)

// InitializeApp is shipment_service's composition root. Regenerate after changing it:
//
//	cd backend && go tool wire ./cmd/shipment_service
func InitializeApp() (*App, error) {
	wire.Build(
		NewConfig,
		NewDatabase,
		NewCache,
		NewSigner,
		NewRoleResolver,

		shipment_v1.NewService,

		NewServeMux,
		NewServer,
		NewApp,
	)

	return nil, nil
}
