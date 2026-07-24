package product_v1

import (
	"context"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductCreate adds a product to the scoped team's catalogue, together with its (up to 5) images
// in one insert. The cover (first image) is denormalised onto the product row.
func (s *Service) ProductCreate(
	ctx context.Context,
	req *connect.Request[productv1.ProductCreateRequest],
) (*connect.Response[productv1.ProductCreateResponse], error) {
	images := req.Msg.GetImages()
	coverURL, coverThumb := coverOf(images)

	product := &product_service_models.Product{
		TeamID:                   req.Msg.GetTeamId(),
		SKU:                      req.Msg.GetSku(),
		Name:                     req.Msg.GetName(),
		Description:              req.Msg.GetDescription(),
		CategoryID:               req.Msg.GetCategoryId(),
		DefaultImageURL:          coverURL,
		DefaultImageThumbnailURL: coverThumb,
		// GORM inserts these rows in the same transaction as the product, stamping their ProductID.
		Images: modelImages(images),
	}

	err := s.db.WithContext(ctx).Create(product).Error
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&productv1.ProductCreateResponse{Product: toProto(product)}), nil
}
