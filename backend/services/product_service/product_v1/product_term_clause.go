package product_v1

import (
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// productTermClause narrows a products query by a typed search term `q` (trimmed, never empty): a product whose NAME or
// CODE NOW holds it — case-insensitive, anywhere, as the lists always searched — or one that carried it as a FORMER code,
// the WHOLE code, case-insensitive (backlog #152 — a-team-code-change-recomposes-its-product-codes, its 🔄 *an old sticker
// scanned before the reprint*, owner Q1 "A": "the product search match[es] … every former code of the same product").
// A former code is matched EQUAL, never as a substring: `ABC-SHOE` finds nothing through the history, while `abc-shoe-42`
// finds the product that was ABC-SHOE-42 before its team's code changed. The former codes are the `old_code` of its
// `code_changed` history lines (#149's product_logs).
//
// Shared by the seller's Products list (ProductList's `q`) and the warehouse's (SearchAmong — its Products list and its
// product picker), so both find a product by its old sticker alike. The history is asked once per statement (an
// uncorrelated IN, a hashed sub-plan); the outer statement keeps its own scope (the team, or the held ids), so a former
// code never reaches past the products the list may show.
func productTermClause(query *gorm.DB, q string) *gorm.DB {
	pattern := "%" + escapeLike(q) + "%"

	return query.Where(
		"products.name ILIKE ? OR products.product_code ILIKE ? OR products.id IN ("+
			"SELECT product_logs.product_id FROM product_logs WHERE lower(product_logs.old_code) = lower(?) AND product_logs.kind = ?)",
		pattern, pattern, q, product_service_models.ProductLogCodeChanged,
	)
}
