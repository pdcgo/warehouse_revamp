package product_v1

import (
	"context"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// categoryCount is one row of the count: a category and how many live products are filed directly under it.
type categoryCount struct {
	CategoryID uint64
	Products   uint64
}

// ProductCategoryCounts answers the Kategori page's *Produk* column (the-product-count-is-a-marked-sample): how many
// products EVERY team has filed directly under each category. A product has exactly one category
// (a-product-has-one-category), so it is one GROUP BY over products_category_idx, whose `archived = FALSE` predicate is
// the statement's own — an archived product is out of the list and every picker, so it is out of the count too
// (scoping's reading, the build's default). A product on no category (0, a row from before categories existed) is left
// out: no node can show it.
//
// What a BRANCH reads — its own products or its whole subtree — is the screen's call (held as the owner's question),
// made on the page from these figures and the tree it already holds; the server only counts what is filed on each node.
//
// Root / the Administrator only, unscoped (the proto's policy): the taxonomy is global and the count is every team's.
func (s *Service) ProductCategoryCounts(
	ctx context.Context,
	_ *connect.Request[productv1.ProductCategoryCountsRequest],
) (*connect.Response[productv1.ProductCategoryCountsResponse], error) {
	var rows []categoryCount

	err := s.db.WithContext(ctx).
		Model(&product_service_models.Product{}).
		Select("category_id, COUNT(*) AS products").
		Where("archived = ?", false).
		Where("category_id <> ?", 0).
		Group("category_id").
		Order("category_id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	counts := make([]*productv1.ProductCategoryCount, 0, len(rows))
	for _, r := range rows {
		counts = append(counts, &productv1.ProductCategoryCount{CategoryId: r.CategoryID, Products: r.Products})
	}

	return connect.NewResponse(&productv1.ProductCategoryCountsResponse{Counts: counts}), nil
}
