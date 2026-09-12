package selling_service_models

import "time"

// OrderDraftItem is a row of `order_draft_items` — one scraped line of a draft.
//
// It carries BOTH what the marketplace said and what we resolved it to. ExternalSKU/ExternalName are
// never overwritten, not even by a person editing the line: they are the evidence of what the buyer
// actually ordered, and keeping them beside the mapping is what lets somebody spot a wrong one.
// ProductID is 0 until a person maps it, and an unmapped line is precisely what keeps this a draft.
type OrderDraftItem struct {
	ID      uint64 `gorm:"primaryKey"`
	DraftID uint64

	ExternalSKU  string `gorm:"column:external_sku"`
	ExternalName string

	// Our catalogue id; 0 = not yet mapped. Opaque product_service id, no FK.
	ProductID uint64

	// Unconstrained on purpose — a scrape may not have been able to read either. Promote is where a
	// quantity of 0 becomes an error, so one unreadable line never costs the other nine.
	Quantity  uint32
	UnitPrice int64

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (OrderDraftItem) TableName() string {
	return "order_draft_items"
}
