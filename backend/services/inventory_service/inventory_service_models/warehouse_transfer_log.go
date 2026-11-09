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
	// The actor was Root or the Administrator, acting in a team they hold no role in (an-override-is-stamped-in-every-service,
	// 00034) — on the trail row, since the transfer carries one actor per act.
	IsOverride  bool
	Description string
	CreatedAt   time.Time
}

func (WarehouseTransferLog) TableName() string {
	return "warehouse_transfer_logs"
}
