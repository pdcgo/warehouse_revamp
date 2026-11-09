package selling_service_models

import "time"

// OrderDraftItem is a row of `order_draft_items` — one scraped line of a draft.
//
// The platform's reference, never a mapping (a-draft-stores-no-mapping; `product_id` dropped by 00047): the CS maps each
// line in the order form, straight into the order's lines. ExternalSKU/ExternalName are never overwritten, not even by a
// person editing the line: they are the evidence of what the buyer actually ordered.
type OrderDraftItem struct {
	ID      uint64 `gorm:"primaryKey"`
	DraftID uint64

	ExternalSKU  string `gorm:"column:external_sku"`
	ExternalName string

	// Unconstrained on purpose — a scrape may not have been able to read either. Promote is where a
	// quantity of 0 becomes an error, so one unreadable line never costs the other nine.
	Quantity  uint32
	UnitPrice float64

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (OrderDraftItem) TableName() string {
	return "order_draft_items"
}
