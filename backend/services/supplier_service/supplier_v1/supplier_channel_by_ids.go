package supplier_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
)

// SupplierChannelByIds reads stores by id, deleted ones included — what a restock line shows, with a deleted badge
// when the store is gone (a-deleted-supplier-still-shows-with-a-badge).
//
// ⚠ Unimplemented until the restock backend step (the-restock-contract-changes-in-place): restock lines do not store
// a store yet, so nothing calls this outside the prototype.
func (s *Service) SupplierChannelByIds(
	_ context.Context,
	_ *connect.Request[supplierv1.SupplierChannelByIdsRequest],
) (*connect.Response[supplierv1.SupplierChannelByIdsResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, errors.New("SupplierChannelByIds lands with the restock backend step"))
}
