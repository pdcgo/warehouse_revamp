package supplier_service_models

import "time"

// SupplierEventLog is a row of `supplier_event_logs` (00002) — one event already folded, the fold's dedup.
//
// ID is the EVENT's id ("restock-accepted:<restock_id>"), never the broker's message id. Day is the Jakarta day the
// figures went to: a replay deletes the dedup rows and the figure rows on that same predicate.
type SupplierEventLog struct {
	ID        string `gorm:"primaryKey"`
	Raw       []byte
	Day       time.Time
	CreatedAt time.Time
}

func (SupplierEventLog) TableName() string {
	return "supplier_event_logs"
}
