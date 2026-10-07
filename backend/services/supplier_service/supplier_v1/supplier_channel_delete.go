package supplier_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// SupplierChannelDelete hides a live store of a live supplier of the scoped team — a SOFT delete
// (a-store-delete-is-soft-too): a restock line names its store, and a deleted store still finds its supplier.
func (s *Service) SupplierChannelDelete(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierChannelDeleteRequest],
) (*connect.Response[supplierv1.SupplierChannelDeleteResponse], error) {
	res := s.db.
		WithContext(ctx).
		Model(&supplier_service_models.SupplierChannel{}).
		Where("id = ? AND deleted_at IS NULL", req.Msg.GetChannelId()).
		Where("supplier_id IN (SELECT id FROM suppliers WHERE team_id = ? AND deleted_at IS NULL)", req.Msg.GetTeamId()).
		Updates(map[string]any{
			"deleted_at": gorm.Expr("NOW()"),
			"updated_at": gorm.Expr("NOW()"),
		})
	if res.Error != nil {
		return nil, internal(res.Error)
	}

	if res.RowsAffected == 0 {
		return nil, notFound(errChannelMissing)
	}

	return connect.NewResponse(&supplierv1.SupplierChannelDeleteResponse{}), nil
}
