package inventory_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RackMove moves goods off one rack onto one or more racks of the same warehouse
// (docs/business/inventory/placement_decision.md, a-move-is-one-rack-to-one-or-more-racks).
//
// ⚠ PROTOTYPE until design_accept: it answers Unimplemented, and the Move dialog runs against the Storybook stub,
// which plays the decided rules. It is a method on *Service rather than an embedded Unimplemented handler so the
// compile-time assertion in service.go keeps catching a forgotten RPC. The backend step writes it on the decided
// ledgers: one `move` transaction per owning team, a row per rack touched, nothing in the batch ledger, all in one
// database transaction (a-move-writes-two-rack-rows-and-no-batch-row, a-move-is-all-or-nothing).
func (s *Service) RackMove(
	ctx context.Context,
	req *connect.Request[inventoryv1.RackMoveRequest],
) (*connect.Response[inventoryv1.RackMoveResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("RackMove is a prototype until design_accept"))
}
