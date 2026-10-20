package inventory_ledgers

import (
	"fmt"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// NewTransaction is what a mutation knows when stock changes.
type NewTransaction struct {
	WarehouseID uint64
	// The ORDERING team for an order, the owner for every other type (an-order-transaction-is-the-ordering-teams).
	TeamID      uint64
	TxType      inventory_service_models.TxType
	ActorID     uint64
	Description string
	// A sample's recipient (a-sample-keeps-its-recipient).
	Recipient string
}

// CreateTransaction inserts the one row every stock change belongs to (every-stock-change-belongs-to-a-transaction).
func CreateTransaction(tx *gorm.DB, in NewTransaction) (inventory_service_models.InventoryTransaction, error) {
	row := inventory_service_models.InventoryTransaction{
		WarehouseID:    in.WarehouseID,
		TeamID:         in.TeamID,
		TxType:         in.TxType,
		CreateByUserID: in.ActorID,
		Description:    in.Description,
		Recipient:      in.Recipient,
	}

	err := tx.Create(&row).Error
	if err != nil {
		return row, fmt.Errorf("inventory transaction: %w", err)
	}

	return row, nil
}

// ItemLine is one product's summary in a transaction.
type ItemLine struct {
	ProductID uint64
	// The product's owner (an-item-carries-its-owning-team).
	ProductTeamID uint64
	// Positive: the transaction's type gives the direction.
	Quantity int64
	Total    float64
}

// AddItems writes one item per product (an-item-names-its-product). IsOwned is whether the product's owner is the
// transaction's team — false only on an order's borrowed line.
func AddItems(tx *gorm.DB, t inventory_service_models.InventoryTransaction, lines []ItemLine) error {
	if len(lines) == 0 {
		return nil
	}

	rows := make([]inventory_service_models.InventoryTransactionItem, 0, len(lines))
	for _, line := range lines {
		rows = append(rows, inventory_service_models.InventoryTransactionItem{
			WarehouseID:   t.WarehouseID,
			TransactionID: t.ID,
			ProductID:     line.ProductID,
			ProductTeamID: line.ProductTeamID,
			IsOwned:       line.ProductTeamID == t.TeamID,
			Quantity:      line.Quantity,
			Total:         line.Total,
		})
	}

	err := tx.Create(&rows).Error
	if err != nil {
		return fmt.Errorf("inventory transaction items: %w", err)
	}

	return nil
}
