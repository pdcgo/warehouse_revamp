package supplier_v1

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// SupplierCreate adds a supplier to the scoped team — which must be a SELLING team
// (only-a-selling-team-has-suppliers). The team is asked of team_service before anything is written.
func (s *Service) SupplierCreate(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierCreateRequest],
) (*connect.Response[supplierv1.SupplierCreateResponse], error) {
	teamID := req.Msg.GetTeamId()

	selling, err := s.teams.IsSelling(ctx, teamID)
	if err != nil {
		return nil, internal(fmt.Errorf("ask team_service about team %d: %w", teamID, err))
	}

	if !selling {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errNotSelling)
	}

	supplier := &supplier_service_models.Supplier{
		TeamID:      teamID,
		Name:        req.Msg.GetName(),
		Contact:     req.Msg.GetContact(),
		Address:     req.Msg.GetAddress(),
		Description: req.Msg.GetDescription(),
	}

	err = s.db.WithContext(ctx).Create(supplier).Error
	if err != nil {
		return nil, internal(err)
	}

	return connect.NewResponse(&supplierv1.SupplierCreateResponse{Supplier: supplierToProto(supplier)}), nil
}
