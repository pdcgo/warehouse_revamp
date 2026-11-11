package inventory_service_models

import "time"

// OrderReturnCheck is a row of `order_return_checks` — an order's take returned ONCE: the take is the key, and the row
// names the `return` transaction it bought, claimed in that transaction. A second accept of the same parcel meets the
// key and is answered with the first one's transaction, never a second stock-in.
type OrderReturnCheck struct {
	TakeTransactionID uint64 `gorm:"primaryKey;autoIncrement:false"`
	TransactionID     uint64
	CreatedAt         time.Time
}

func (OrderReturnCheck) TableName() string {
	return "order_return_checks"
}
