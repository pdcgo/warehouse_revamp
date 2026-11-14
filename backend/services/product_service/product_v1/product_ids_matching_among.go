package product_v1

import (
	"context"
	"strings"

	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// IDsMatchingAmong narrows a KNOWN set of products to those whose name or product code contains `q` (case-insensitive,
// anywhere) — their ids, in id order. Only among `ids`, never the rest of the catalogue; an empty set or an empty term
// matches nothing.
//
// It answers the search of a supplier's Produk tab (the-products-tab-searches-and-pages): supplier_service holds which
// products were bought from the supplier (`supplier_channel_products`), and hands their ids here, where the names and
// codes live — then pages its own rows by what matched. SearchAmong's predicate, without its window: the caller pages.
//
// A plain method, not an RPC: the composition root calls it for supplier_service, whose SupplierProductList ran its own
// policy, and it reads nothing but product_service's rows (HARD RULE 3). Archived and locked products are in — a product
// bought from a supplier stays on its Produk tab whatever became of it in the catalogue.
//
// The ids go as ONE array parameter, not a list GORM expands — a supplier that sold for years has thousands of products.
func (s *Service) IDsMatchingAmong(ctx context.Context, ids []uint64, q string) ([]uint64, error) {
	q = strings.TrimSpace(q)
	if len(ids) == 0 || q == "" {
		return nil, nil
	}

	pattern := "%" + escapeLike(q) + "%"

	var matched []uint64

	err := s.db.
		WithContext(ctx).
		Model(&product_service_models.Product{}).
		Where("id = ANY(CAST(? AS bigint[]))", idArray(ids)).
		Where("name ILIKE ? OR product_code ILIKE ?", pattern, pattern).
		Order("id").
		Pluck("id", &matched).
		Error
	if err != nil {
		return nil, err
	}

	return matched, nil
}
