package selling_service_models

import "time"

// OrderItem is a row of `order_items` — one line of an order. product_id is an opaque product_service
// id; sku/name are a SNAPSHOT at order time so later catalogue edits never rewrite an order's history.
// Schema owned by goose.
//
// ⚠ A LINE CARRIES NO MARKETPLACE PRICE (an-order-line-carries-no-marketplace-price): every money column below is what
// inventory's take drew and priced the line at. What the marketplace charged lives on the draft's platform rows only.
type OrderItem struct {
	ID        uint64 `gorm:"primaryKey"`
	OrderID   uint64
	ProductID uint64
	SKU       string `gorm:"column:sku"`
	Name      string
	Quantity  uint32
	// What this product COST us, per unit, frozen at order time (#74) — the owner's `unit_cost`: the units the take drew
	// ÷ the quantity (an-order-is-costed-at-what-leaves-the-shelf), rounded to whole rupiah. 0 means UNKNOWN, not free.
	UnitCost int64
	// THE LINE'S FROZEN TOTAL, rupiah — what inventory's take priced it at: the goods it drew plus, on another team's
	// product, that product's own cross markup (inventory-computes-the-markup). The product fee is posted from it
	// (the-ledger-charges-the-frozen-line-total). nil = never frozen: a line placed before the column existed.
	Total *float64
	// One unit at the owner's markup (00025) — the owner's `unit_cost_with_markup`, Total ÷ Quantity as the take
	// returned it. On an own line, the unit cost. Unrounded. nil = never frozen.
	UnitCostWithMarkup *float64
	// What the markup added (00025) — the owner's `markup_total`, Total − the drawn cost, as the take returned it. 0 on
	// an own line. Unrounded. nil = never frozen.
	MarkupTotal *float64
	CreatedAt   time.Time
}

func (OrderItem) TableName() string {
	return "order_items"
}
