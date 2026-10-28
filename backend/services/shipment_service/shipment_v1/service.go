// Package shipment_v1 implements warehouse.shipment.v1's two services: ShipmentChannelService — the
// courier catalogue — and ReceiptService, which reads an uploaded shipping label (receipt_check.go).
//
// Design: docs/business/shipment/context_decision.md. Channel reads are public, channel writes are root
// only, and the label check takes any signed-in user; all three are enforced by the access interceptor
// from the proto policy, so the handlers carry no auth logic.
package shipment_v1

import (
	"errors"
	"io"

	"connectrpc.com/connect"
	"github.com/pdcgo/san_receipt_readers"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1/shipmentv1connect"
)

// Service is the ShipmentChannelService handler over `shipment_channels`, and the ReceiptService handler,
// which touches no table at all.
type Service struct {
	db *gorm.DB

	// checks holds one token per label check running right now — at most receiptChecksAtOnce, shared by every
	// call this Service serves (receipt_check.go).
	checks chan struct{}
	// extract is the label reader. Always san_receipt_readers.Extract outside a test: it is a field only so a test
	// can hold a check open (export_test.go).
	extract func(io.Reader) (san_receipt_readers.ReceiptData, error)
}

var (
	_ shipmentv1connect.ShipmentChannelServiceHandler = (*Service)(nil)
	_ shipmentv1connect.ReceiptServiceHandler         = (*Service)(nil)
)

func NewService(db *gorm.DB) *Service {
	return &Service{
		db:      db,
		checks:  make(chan struct{}, receiptChecksAtOnce),
		extract: san_receipt_readers.Extract,
	}
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
