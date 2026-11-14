package supplier_v1

import (
	"context"
	"errors"
)

// ProductCatalog is what supplier_service asks product_service about the products on its Produk tab — their names, SKUs
// and pictures, and which of them a search matches (the-products-tab-searches-and-pages). Answered IN-PROCESS by the
// composition root (cmd/app_development/supplier_products.go) from product_service's own rows, so this service keeps no
// copy of the catalogue: a link stores only the product's id (products-hang-off-a-channel).
//
// Any team's product: a supplier's products are not private to the team that bought them
// (another-team-sees-everything-of-a-supplier). Nothing here carries a price or a cost.
type ProductCatalog interface {
	// ProductCards names products by id, at most a page of them. An id that resolves to nothing is absent, and its row
	// keeps the id with empty facts.
	ProductCards(ctx context.Context, ids []uint64) (map[uint64]ProductCard, error)

	// ProductIDsMatching narrows `among` — the supplier's own products — to those whose name or SKU contains `q`
	// (case-insensitive, anywhere). Only among them, never the rest of the catalogue.
	ProductIDsMatching(ctx context.Context, among []uint64, q string) ([]uint64, error)
}

// ProductCard is how a product row reads it — the app's one way to draw a product: its name, its SKU under it, its
// list-sized picture ("" = none, the screen draws the placeholder).
type ProductCard struct {
	Name, Code, ThumbnailURL string
}

var errNoProductCatalog = errors.New("no product_service to name a supplier's products")

// noProducts is what a Service built without product_service uses: every question is an ERROR, never an empty answer —
// a page of nameless rows, or a search that matches nothing, would read as real.
type noProducts struct{}

func (noProducts) ProductCards(context.Context, []uint64) (map[uint64]ProductCard, error) {
	return nil, errNoProductCatalog
}

func (noProducts) ProductIDsMatching(context.Context, []uint64, string) ([]uint64, error) {
	return nil, errNoProductCatalog
}
