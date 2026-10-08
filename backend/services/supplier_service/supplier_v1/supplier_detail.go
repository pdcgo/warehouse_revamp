package supplier_v1

import (
	"context"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
)

// SupplierDetail reads ANY team's live supplier (another-team-sees-everything-of-a-supplier). The My Supplier
// detail and the Discover Supplier detail read the same record; the screen offers Edit only when the
// supplier's team_id is the caller's. A deleted supplier is NotFound here — only SupplierByIds returns one.
func (s *Service) SupplierDetail(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierDetailRequest],
) (*connect.Response[supplierv1.SupplierDetailResponse], error) {
	supplier, err := liveSupplier(s.db.WithContext(ctx), req.Msg.GetSupplierId())
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&supplierv1.SupplierDetailResponse{Supplier: supplierToProto(supplier)}), nil
}
