package supplier_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// SupplierDelete hides a live supplier of the scoped team — a SOFT delete
// (a-deleted-supplier-is-kept-for-its-figures). Its stores are left exactly as they are: they hide with it,
// because every store read requires a live supplier. A second delete is NotFound, as for any non-live row.
func (s *Service) SupplierDelete(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierDeleteRequest],
) (*connect.Response[supplierv1.SupplierDeleteResponse], error) {
	res := s.db.
		WithContext(ctx).
		Model(&supplier_service_models.Supplier{}).
		Where("id = ? AND team_id = ? AND deleted_at IS NULL", req.Msg.GetSupplierId(), req.Msg.GetTeamId()).
		Updates(map[string]any{
			"deleted_at": gorm.Expr("NOW()"),
			"updated_at": gorm.Expr("NOW()"),
		})
	if res.Error != nil {
		return nil, internal(res.Error)
	}

	if res.RowsAffected == 0 {
		return nil, notFound(errSupplierMissing)
	}

	return connect.NewResponse(&supplierv1.SupplierDeleteResponse{}), nil
}
