// Package shipment_v1 implements warehouse.shipment.v1.ShipmentChannelService — the courier catalogue.
//
// Design: docs/business/shipment/context_decision.md. Reads are public and writes are root only; both
// are enforced by the access interceptor from the proto policy, so the handlers carry no auth logic.
package shipment_v1

import (
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1/shipmentv1connect"
)

// Service is the ShipmentChannelService handler over `shipment_channels`.
type Service struct {
	db *gorm.DB
}

var _ shipmentv1connect.ShipmentChannelServiceHandler = (*Service)(nil)

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

var errChannelMissing = errors.New("shipment channel not found")

func notFound() error {
	return connect.NewError(connect.CodeNotFound, errChannelMissing)
}

// dbError maps a duplicate code to AlreadyExists — the unique index is the last word when two creates
// race past the pre-check — and everything else to Internal.
func dbError(err error) error {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return connect.NewError(connect.CodeAlreadyExists, errors.New("a shipment channel with this code already exists"))
	}

	return connect.NewError(connect.CodeInternal, err)
}
