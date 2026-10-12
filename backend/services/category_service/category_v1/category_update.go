package category_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	categoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/category/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/category_service/category_service_models"
)

// CategoryUpdate edits a category. Absent fields are left alone. Reparenting is guarded: a category
// cannot become its own parent (InvalidArgument), and a non-zero new parent must exist and be active
// (InvalidArgument). parent_id = 0 moves the category to the top level (NULL).
func (s *Service) CategoryUpdate(
	ctx context.Context,
	req *connect.Request[categoryv1.CategoryUpdateRequest],
) (*connect.Response[categoryv1.CategoryUpdateResponse], error) {
	categoryID := req.Msg.GetCategoryId()

	// Self-parent is an argument error — reject it before touching the database.
	if req.Msg.ParentId != nil && req.Msg.GetParentId() == categoryID {
		return nil, connect.NewError(connect.CodeInvalidArgument, errSelfParent)
	}

	updates := map[string]any{}

	if req.Msg.Name != nil {
		updates["name"] = req.Msg.GetName()
	}

	if req.Msg.ParentId != nil {
		// 0 → NULL (top-level); any other id → that parent.
		updates["parent_id"] = parentIDPtr(req.Msg.GetParentId())
	}

	var category category_service_models.Category

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Check existence FIRST — Postgres reports 0 rows affected when an UPDATE writes identical
		// values, so inferring NotFound from RowsAffected would misfire on a no-op resubmit.
		exists, err := categoryActive(tx, categoryID)
		if err != nil {
			return err
		}

		if !exists {
			return errCategoryMissing
		}

		// A non-zero new parent must reference an active category.
		if req.Msg.ParentId != nil && req.Msg.GetParentId() != 0 {
			parentExists, err := categoryActive(tx, req.Msg.GetParentId())
			if err != nil {
				return err
			}

			if !parentExists {
				return errParentMissing
			}
		}

		if len(updates) > 0 {
			err = tx.
				Model(&category_service_models.Category{}).
				Where("id = ?", categoryID).
				Updates(withUpdatedAt(updates)).
				Error
			if err != nil {
				return err
			}
		}

		return tx.Where("id = ?", categoryID).First(&category).Error
	})
	if err != nil {
		switch {
		case errors.Is(err, errCategoryMissing):
			return nil, notFound()
		case errors.Is(err, errParentMissing):
			return nil, connect.NewError(connect.CodeInvalidArgument, errParentMissing)
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&categoryv1.CategoryUpdateResponse{Category: toProto(&category)}), nil
}
