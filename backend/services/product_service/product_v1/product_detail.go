package product_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductDetail returns one product in the scoped team, with its full ordered image gallery.
// The team_id clause is the scope check — another team's product reads as NotFound.
//
// ARCHIVED products are returned too, and `deleted` on the response is how a caller tells. They have
// to be: archiving is reversible, the way back is ProductRestore, and the detail page is where a
// person stands when they decide to take it. Filtering them out here made that page answer NotFound
// the instant somebody archived from it — the product still existed, still owned its stock and its
// order history, and the only screen that could show it had just denied it existed.
//
// This is NOT a licence to show archived products in a list something is picked FROM. Those read
// through ProductList, whose status filter still defaults to ACTIVE for exactly that reason. A detail
// read is somebody naming one row by id, which is a different act from browsing a catalogue.
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
		Where("id = ? AND team_id = ?", req.Msg.GetProductId(), req.Msg.GetTeamId()).
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
