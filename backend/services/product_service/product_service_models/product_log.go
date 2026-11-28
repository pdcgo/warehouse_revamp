package product_service_models

import "time"

// ProductLog is a row of `product_logs` — one line of a product's history (backlog #149): today only `code_changed`, the
// code it took when its team's code changed (a-team-code-change-recomposes-its-product-codes), read by the product page's
// Riwayat Produk card (ProductLogList). Append-only. Its `old_code` is also the product's FORMER code, which still finds
// it (the decision's Q1 "A", backlog #152).
type ProductLog struct {
	ID        uint64 `gorm:"primaryKey"`
	ProductID uint64
	Kind      string
	OldCode   string
	NewCode   string
	// The opaque user_service id of whoever changed the team code, and whether they were Root or the Administrator outside
	// the team (an-override-is-stamped-in-every-service).
	ActorID    uint64
	IsOverride bool
	CreatedAt  time.Time
}

func (ProductLog) TableName() string {
	return "product_logs"
}

// ProductLogCodeChanged is the kind of the line a team code change writes.
const ProductLogCodeChanged = "code_changed"
