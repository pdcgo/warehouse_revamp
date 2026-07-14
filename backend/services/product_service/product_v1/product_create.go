package product_v1

import (
	"context"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductCreate adds a product to the scoped team's catalogue.
func (s *Service) ProductCreate(
	ctx context.Context,
	req *connect.Request[productv1.ProductCreateRequest],
) (*connect.Response[productv1.ProductCreateResponse], error) {
	product := &product_service_models.Product{
		TeamID:      req.Msg.GetTeamId(),
		SKU:         req.Msg.GetSku(),
		Name:        req.Msg.GetName(),
		Description: req.Msg.GetDescription(),
	}

	err := s.db.WithContext(ctx).Create(product).Error
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&productv1.ProductCreateResponse{Product: toProto(product)}), nil
}
