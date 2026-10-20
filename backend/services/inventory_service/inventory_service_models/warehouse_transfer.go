package inventory_service_models

import "time"

// TransferStatus is where a warehouse transfer is (a-transfer-has-seven-statuses), in the owner's words.
type TransferStatus string

const (
	TransferCreated  TransferStatus = "created"
	TransferProcess  TransferStatus = "process"
	TransferShipped  TransferStatus = "shipped"
	TransferArrived  TransferStatus = "arrived"
	TransferAccepted TransferStatus = "accepted"
	TransferCancel   TransferStatus = "cancel"
	TransferLost     TransferStatus = "lost"
)

// WarehouseTransfer is a row of `warehouse_transfers` — a selling team moving its own stock from warehouse A to
// warehouse B. Its two legs are ledger transactions; the pick list and B's put-away are their rack rows, not columns
// here. Schema owned by goose (00027); GORM only reads and writes rows.
type WarehouseTransfer struct {
	ID              uint64 `gorm:"primaryKey"`
	TeamID          uint64
	FromWarehouseID uint64
	ToWarehouseID   uint64
	Status          TransferStatus
	Note            string
	Total           float64

	ShipmentID  uint64
	Receipt     string
	ReceiptFile string

	ShipmentCost     float64
	FinanceAccountID uint64
	// Bumped by every edit that moves money — the edit's event id (the-shipping-expense-reaches-the-account-by-event).
	CostRevision                uint64
	WarehouseAdditionalCost     float64
	WarehouseAdditionalCostNote string

	// nil = not written yet. The inbound stays nil when no unit arrived good.
	OutboundTransactionID *uint64
	InboundTransactionID  *uint64

	CreatedByUserID   uint64
	ProcessedByUserID uint64
	ProcessedAt       *time.Time
	ShippedByUserID   uint64
	ShippedAt         *time.Time
	ArrivedByUserID   uint64
	ArrivedAt         *time.Time
	AcceptedByUserID  uint64
	AcceptedAt        *time.Time
	CancelledByUserID uint64
	CancelledAt       *time.Time
	LostByUserID      uint64
	LostAt            *time.Time

	UpdatedAt time.Time
	CreatedAt time.Time

	Items    []WarehouseTransferItem        `gorm:"foreignKey:TransferID"`
	Problems []WarehouseTransferProblemItem `gorm:"foreignKey:TransferID"`
	Logs     []WarehouseTransferLog         `gorm:"foreignKey:TransferID"`
}

func (WarehouseTransfer) TableName() string {
	return "warehouse_transfers"
}
