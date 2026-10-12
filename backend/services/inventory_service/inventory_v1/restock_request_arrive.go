package inventory_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RestockRequestArrive is the warehouse signing for the box: ongoing or lost → arrived
// (the-warehouse-signs-and-accepts-the-team-does-the-rest, a-late-lost-box-is-signed-for-as-arrived).
//
// ⚠ Unimplemented until the backend step (the-restock-contract-changes-in-place): it needs the arrived_at and
// arrived_by columns, and the arrived window it opens — lines editable, nothing else — lands with it.
func (s *Service) RestockRequestArrive(
	_ context.Context,
	_ *connect.Request[inventoryv1.RestockRequestArriveRequest],
) (*connect.Response[inventoryv1.RestockRequestArriveResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("RestockRequestArrive lands with the restock backend step"))
}
