package inventory_service_models

import "time"

// TxType names the ONE direction a transaction moves stock (problem-and-found-replace-opname). The same words are the
// ledgers' change_type, except that a problem's rows carry its reason, broken or lost.
type TxType string

const (
	TxOrder       TxType = "order"
	TxRestock     TxType = "restock"
	TxReturn      TxType = "return"
	TxSample      TxType = "sample"
	TxTransferIn  TxType = "transfer_in"
	TxTransferOut TxType = "transfer_out"
	TxAdjustment  TxType = "adjustment"
	TxRevaluation TxType = "revaluation"
	TxProblem     TxType = "problem"
	TxFound       TxType = "found"
	TxMove        TxType = "move"
)

// InventoryTransaction is a row of `inventory_transactions` — one stock change (every-stock-change-belongs-to-a-transaction).
// TeamID is the ORDERING team for an order and the owner for every other type (an-order-transaction-is-the-ordering-teams).
// Schema owned by goose (00025); GORM only reads and writes rows.
type InventoryTransaction struct {
	ID             uint64 `gorm:"primaryKey"`
	WarehouseID    uint64
	TeamID         uint64
	TxType         TxType
	CreateByUserID uint64
	// Set once, by the rollback (an-undo-rolls-the-transaction-back-once). Only a take is ever rolled back.
	IsRollback  bool
	Description string
	// A sample's recipient (a-sample-keeps-its-recipient); empty on every other type.
	Recipient string
	UpdatedAt time.Time
	CreatedAt time.Time
}

func (InventoryTransaction) TableName() string {
	return "inventory_transactions"
}
