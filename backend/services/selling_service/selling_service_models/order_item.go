package selling_service_models

import "time"

// OrderItem is a row of `order_items` — one line of an order. product_id is an opaque product_service
// id; sku/name/unit_price are a SNAPSHOT at order time so later catalogue edits never rewrite an
// order's history. Money is whole rupiah (int64). Schema owned by goose.
type OrderItem struct {
	ID        uint64 `gorm:"primaryKey"`
	OrderID   uint64
	ProductID uint64
	SKU       string `gorm:"column:sku"`
	Name      string
	Quantity  uint32
	UnitPrice int64
	// What this product COST us, per unit, frozen at order time (#74). UnitPrice is what the buyer
	// pays; this is what we paid. 0 means UNKNOWN (never restocked), not free.
	UnitCost  int64
	CreatedAt time.Time
}

func (OrderItem) TableName() string {
	return "order_items"
}
