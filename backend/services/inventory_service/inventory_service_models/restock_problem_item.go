package inventory_service_models

import "time"

// RestockProblemItem is a row of `restock_problem_items` (00030) — units of one line that arrived broken or never
// arrived at all. Keyed by restock and product: a product appears once per restock, so its product finds its line
// (restock_decision: "no restock_item_id is needed"), and there is one row per kind.
//
// They NEVER ENTER STOCK: a line's good units are received − broken, and this counts what is not sellable, so nobody
// can pick a box that is already crushed. The TABLE says it happened at the door, so the selling team bears it
// (a-loss-is-named-by-where-it-happened).
type RestockProblemItem struct {
	ID        uint64 `gorm:"primaryKey"`
	RestockID uint64
	ProductID uint64
	// The line's store, copied at accept. Optional.
	SupplierChannelID *uint64

	// "broken" or "missing" (a-short-unit-at-the-door-is-missing). The database CHECKs the two words.
	ProblemType string
	Count       int64

	// What each unit was worth, FILLED BY THE SYSTEM at accept, never typed (the-problem-price-is-filled-by-the-system):
	// the landed unit price, the same as a good unit's (all-qty-is-every-unit-ordered). Total = PriceUnit × Count.
	PriceUnit float64
	Total     float64

	// The warehouse's note on these units — optional (a-broken-reason-is-optional, three-notes-one-writer-each).
	Note string

	CreatedAt time.Time
}

func (RestockProblemItem) TableName() string {
	return "restock_problem_items"
}
