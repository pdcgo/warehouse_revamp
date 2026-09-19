// Package category_v1 implements warehouse.category.v1.CategoryService — the GLOBAL, nested
// product-category taxonomy.
//
// Categories are NOT team-scoped: root/admin curate one shared tree and every authenticated user
// reads it (the ACL is enforced by the access interceptor from the proto policy, so the handlers
// carry no auth logic). A category may have a parent (parent_id NULL = top-level), so the list forms
// a tree.
package category_v1

import (
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/category/v1/categoryv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/services/category_service/category_service_models"
)

type Service struct {
	db *gorm.DB
}

// compile-time proof Service satisfies the generated handler interface.
var _ categoryv1connect.CategoryServiceHandler = (*Service)(nil)

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

var (
	errCategoryMissing = errors.New("category not found")
	errParentMissing   = errors.New("parent category not found")
	errSelfParent      = errors.New("a category cannot be its own parent")
	errHasChildren     = errors.New("cannot delete a category that has sub-categories")
)

func notFound() error {
	return connect.NewError(connect.CodeNotFound, errCategoryMissing)
}

// dbError maps a duplicate name to AlreadyExists (a client error) and everything else to Internal.
func dbError(err error) error {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return connect.NewError(connect.CodeAlreadyExists,
			errors.New("a category with this name already exists under that parent"))
	}

	return connect.NewError(connect.CodeInternal, err)
}

// categoryActive reports whether an ACTIVE category with this id exists. Used both to check the
// target of an update/delete and to validate a proposed parent.
func categoryActive(tx *gorm.DB, id uint64) (bool, error) {
	var count int64

	err := tx.
		Model(&category_service_models.Category{}).
		Where("id = ? AND deleted = ?", id, false).
		Count(&count).
		Error

	return count > 0, err
}

func withUpdatedAt(updates map[string]any) map[string]any {
	updates["updated_at"] = time.Now()

	return updates
}
