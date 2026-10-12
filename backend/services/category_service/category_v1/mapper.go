package category_v1

import (
	categoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/category/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/category_service/category_service_models"
)

func toProto(c *category_service_models.Category) *categoryv1.Category {
	var parentID uint64
	if c.ParentID != nil {
		parentID = *c.ParentID
	}

	return &categoryv1.Category{
		Id:       c.ID,
		Name:     c.Name,
		ParentId: parentID,
	}
}

// parentIDPtr maps the wire's parent_id (0 = top-level) to the DB's nullable parent_id: 0 → NULL,
// any other id → a pointer to it.
func parentIDPtr(parentID uint64) *uint64 {
	if parentID == 0 {
		return nil
	}

	return &parentID
}
