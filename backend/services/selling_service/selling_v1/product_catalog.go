package selling_v1

import "context"

// ProductSnapshot is what an order line freezes about a product: its catalogue label at the moment
// the order was placed. Money is not here — what the buyer pays comes from the order, and what we
// paid comes from the warehouse (`StockPicker.UnitCosts`).
type ProductSnapshot struct {
	SKU  string
	Name string
}

// ProductCatalog is how selling_service reads product LABELS (#194).
//
// It exists because promote must build an order's lines from a draft, and a draft line stores only a
// `product_id` — the sku and name an order freezes are not in it. The client cannot supply them
// either: promote's request names a draft, not a basket, so there is nowhere honest for them to come
// from except the catalogue itself. (OrderCreate takes them from the request because the person
// typing the order has the catalogue open in front of them.)
//
// It doubles as the STALE-REFERENCE CHECK the design asked for. A draft names products by id with no
// FK, so one can be deleted underneath it; an id that resolves to nothing is exactly that case, and
// promote names which product died rather than returning a bare validation error.
//
// An interface this service owns, in this service's own terms, for the same reason StockPicker is:
// selling_service must not import product_service. The adapter lives in the composition root.
type ProductCatalog interface {
	// Snapshots resolves ids to their catalogue labels. An id that resolves to NOTHING is absent from
	// the map rather than an error — "this product is gone" is a fact the caller needs to report per
	// id, not a reason to fail a lookup of twelve.
	//
	// `sellingTeamID` is the team the CALLER holds a role in, not the products' owning team.
	Snapshots(ctx context.Context, sellingTeamID uint64, productIDs []uint64) (map[uint64]ProductSnapshot, error)
}
