package inventory_service_models

import "time"

// IdempotencyOrderCheck is a row of `idempotency_order_check` — an order's key K, claimed once
// (the-key-is-claimed-in-its-own-table). TransactionID nil means the key was released before anything was taken.
type IdempotencyOrderCheck struct {
	ID             uint64 `gorm:"primaryKey"`
	IdempotencyKey string
	TransactionID  *uint64
	CreatedAt      time.Time
}

func (IdempotencyOrderCheck) TableName() string {
	return "idempotency_order_check"
}
