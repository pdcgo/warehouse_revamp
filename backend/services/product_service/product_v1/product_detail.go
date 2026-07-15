package product_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductDetail returns one active product in the scoped team, with its full ordered image gallery.
// The team_id clause is the scope check — another team's product reads as NotFound.
func (s *Service) ProductDetail(
	ctx context.Context,
	req *connect.Request[productv1.ProductDetailRequest],
) (*connect.Response[productv1.ProductDetailResponse], error) {
	var product product_service_models.Product

	err := s.db.
		WithContext(ctx).
		Preload("Images", func(db *gorm.DB) *gorm.DB {
			return db.Order("position ASC, id ASC")
		}).
		Where("id = ? AND team_id = ? AND deleted = ?", req.Msg.GetProductId(), req.Msg.GetTeamId(), false).
		First(&product).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&productv1.ProductDetailResponse{Product: toProto(&product)}), nil
}
