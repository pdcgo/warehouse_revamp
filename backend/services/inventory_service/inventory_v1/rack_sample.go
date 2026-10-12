package inventory_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RackSample records a sample taken from one rack and handed to a person at the warehouse
// (docs/business/inventory/transaction_decision.md, a-sample-is-handed-over-at-the-warehouse).
//
// ⚠ PROTOTYPE until design_accept: it answers Unimplemented, and the Record Sample dialog runs against the Storybook
// stub. The backend step writes one `sample` transaction per owning team, taking from the request's rack and the
// oldest batch first (a-sample-names-the-rack-it-was-taken-from); a sample is never rolled back
// (a-handed-over-sample-is-final). Who bears it is still open (transaction Q6).
func (s *Service) RackSample(
	ctx context.Context,
	req *connect.Request[inventoryv1.RackSampleRequest],
) (*connect.Response[inventoryv1.RackSampleResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("RackSample is a prototype until design_accept"))
}
