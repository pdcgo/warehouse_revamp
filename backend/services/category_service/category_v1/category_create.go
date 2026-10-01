package category_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	categoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/category/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/category_service/category_service_models"
)

// CategoryCreate adds a node to the global taxonomy. parent_id = 0 makes it top-level; any other
// parent_id must reference an existing, active category (else InvalidArgument — a soft-deleted
// parent would pass the FK but is not a valid place to hang a new child).
func (s *Service) CategoryCreate(
	ctx context.Context,
	req *connect.Request[categoryv1.CategoryCreateRequest],
) (*connect.Response[categoryv1.CategoryCreateResponse], error) {
	category := &category_service_models.Category{
		Name:     req.Msg.GetName(),
		ParentID: parentIDPtr(req.Msg.GetParentId()),
	}

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if category.ParentID != nil {
			exists, err := categoryActive(tx, *category.ParentID)
			if err != nil {
				return err
			}

			if !exists {
				return errParentMissing
			}
		}

		return tx.Create(category).Error
	})
	if err != nil {
		if errors.Is(err, errParentMissing) {
			return nil, connect.NewError(connect.CodeInvalidArgument, errParentMissing)
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&categoryv1.CategoryCreateResponse{Category: toProto(category)}), nil
}
