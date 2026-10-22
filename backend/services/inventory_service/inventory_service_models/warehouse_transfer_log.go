package inventory_service_models

import "time"

// WarehouseTransferLog is a row of `warehouse_transfer_logs` — one status change (every-transfer-status-change-is-logged).
// FromStatus is empty on the first row.
type WarehouseTransferLog struct {
	ID          uint64 `gorm:"primaryKey"`
	TransferID  uint64
	FromStatus  TransferStatus
	ToStatus    TransferStatus
	ActorUserID uint64
	Description string
	CreatedAt   time.Time
}

func (WarehouseTransferLog) TableName() string {
	return "warehouse_transfer_logs"
}
