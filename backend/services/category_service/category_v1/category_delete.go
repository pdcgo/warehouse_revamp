package category_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	categoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/category/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/category_service/category_service_models"
)

// CategoryDelete soft-deletes a category (`deleted = true`), which also frees its name for reuse
// under the same parent. It REFUSES to delete a category that still has active children
// (FailedPrecondition) rather than silently orphaning them — reparent or delete them first.
func (s *Service) CategoryDelete(
	ctx context.Context,
	req *connect.Request[categoryv1.CategoryDeleteRequest],
) (*connect.Response[categoryv1.CategoryDeleteResponse], error) {
	categoryID := req.Msg.GetCategoryId()

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		exists, err := categoryActive(tx, categoryID)
		if err != nil {
			return err
		}

		if !exists {
			return errCategoryMissing
		}

		var children int64

		err = tx.
			Model(&category_service_models.Category{}).
			Where("parent_id = ? AND deleted = ?", categoryID, false).
			Count(&children).
			Error
		if err != nil {
			return err
		}

		if children > 0 {
			return errHasChildren
		}

		return tx.
			Model(&category_service_models.Category{}).
			Where("id = ?", categoryID).
			Updates(withUpdatedAt(map[string]any{"deleted": true})).
			Error
	})
	if err != nil {
		switch {
		case errors.Is(err, errCategoryMissing):
			return nil, notFound()
		case errors.Is(err, errHasChildren):
			return nil, connect.NewError(connect.CodeFailedPrecondition, errHasChildren)
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&categoryv1.CategoryDeleteResponse{}), nil
}
