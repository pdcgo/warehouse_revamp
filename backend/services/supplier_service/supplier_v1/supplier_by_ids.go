package supplier_v1

import (
	"context"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// SupplierByIds resolves ids the caller already holds — a restock naming its vendor — whoever keeps them,
// and DELETED ONES INCLUDED, marked (a-deleted-supplier-is-kept-for-its-figures). It is the one read without
// `deleted_at IS NULL`: a purchase outlives its vendor record. An unknown id is absent, never an error.
func (s *Service) SupplierByIds(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierByIdsRequest],
) (*connect.Response[supplierv1.SupplierByIdsResponse], error) {
	var suppliers []supplier_service_models.Supplier

	err := s.db.
		WithContext(ctx).
		Where("id IN ?", req.Msg.GetFilter().GetIds()).
		Find(&suppliers).
		Error
	if err != nil {
		return nil, internal(err)
	}

	return connect.NewResponse(&supplierv1.SupplierByIdsResponse{
		Items: supplierByIdsMap(suppliers, req.Msg.GetDataRequest()),
	}), nil
}
