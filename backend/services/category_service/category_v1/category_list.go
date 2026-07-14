package category_v1

import (
	"context"

	"connectrpc.com/connect"

	categoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/category/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/category_service/category_service_models"
)

// CategoryList returns the whole active taxonomy as a flat list — each category carries its
// parent_id, and the client assembles the tree. It is global reference data, so there is no scope
// filter and no pagination; ordering by name keeps the picker stable.
func (s *Service) CategoryList(
	ctx context.Context,
	req *connect.Request[categoryv1.CategoryListRequest],
) (*connect.Response[categoryv1.CategoryListResponse], error) {
	var categories []category_service_models.Category

	err := s.db.
		WithContext(ctx).
		Where("deleted = ?", false).
		Order("name").
		Find(&categories).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	out := make([]*categoryv1.Category, 0, len(categories))
	for i := range categories {
		out = append(out, toProto(&categories[i]))
	}

	return connect.NewResponse(&categoryv1.CategoryListResponse{Categories: out}), nil
}
