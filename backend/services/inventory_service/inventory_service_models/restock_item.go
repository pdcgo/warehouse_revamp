package inventory_service_models

import "time"

// RestockItem is a row of `restock_items` (00030) — one product on a restock, how many were ordered, and what the line
// cost. A product appears once per restock (a-product-appears-once-per-restock), which the database enforces.
//
// sku/name are SNAPSHOTS taken at raise time: the product may be renamed or deleted later, and the restock must keep
// reading as it was raised.
type RestockItem struct {
	ID        uint64 `gorm:"primaryKey"`
	RestockID uint64
	// Opaque product_service id — no FK.
	ProductID uint64
	SKU       string
	Name      string

	// Count is what was ORDERED. Total is THE LINE TOTAL, as the invoice prints it (a-line-is-typed-as-its-total) —
	// the truth. PriceUnit is total ÷ count, for display, written whenever either changes and never typed.
	Count     int64
	Total     float64
	PriceUnit float64

	// What was IN THE BOX when the warehouse counted it, broken units included (any-warehouse-member-counts-what-
	// arrived). Kept beside Count rather than replacing it: the gap between ordered and arrived is the record's whole
	// value. 0 until accepted.
	ReceivedCount int64

	// Who sold this line, and through which store (a-line-names-the-channel-it-was-bought-from,
	// a-line-may-name-a-supplier-without-a-channel): opaque supplier_service ids, both optional, the store one of the
	// supplier's. Note is the selling team's word on the line, e.g. "extra stock" (three-notes-one-writer-each).
	SupplierID        *uint64
	SupplierChannelID *uint64
	Note              string

	// WHERE the good units went — read from the accept's own rack rows in the placement ledger, never stored here.
	Placements []RestockReceivedPlacement `gorm:"-"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (RestockItem) TableName() string {
	return "restock_items"
}

// RestockReceivedPlacement is how many of an accepted line's good units went to ONE rack — NOT a table: the accept's
// rack rows in `product_placement_logs` are the record (putting-away-at-accept-is-not-a-move), and the detail reads
// them back into this shape. A line carries a LIST of these, because a delivery of 100 does not go on one shelf; they
// sum to the line's good units (there-is-no-unplaced-pile).
type RestockReceivedPlacement struct {
	RestockItemID uint64
	RackID        *uint64
	Quantity      int64
}
