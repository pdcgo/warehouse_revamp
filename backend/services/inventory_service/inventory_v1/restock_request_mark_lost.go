package inventory_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RestockRequestMarkLost is the selling team giving the parcel up: ongoing → lost
// (lost-is-set-only-before-the-box-arrives).
//
// ⚠ Unimplemented until the backend step (the-restock-contract-changes-in-place): it needs the lost_at and lost_by
// columns.
func (s *Service) RestockRequestMarkLost(
	_ context.Context,
	_ *connect.Request[inventoryv1.RestockRequestMarkLostRequest],
) (*connect.Response[inventoryv1.RestockRequestMarkLostResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("RestockRequestMarkLost lands with the restock backend step"))
}
