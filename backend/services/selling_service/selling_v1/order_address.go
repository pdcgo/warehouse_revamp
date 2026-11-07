package selling_v1

import (
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// attachAddresses fills each order's Address from `order_addresses` — ONE query for the set, so a page of orders costs
// one more indexed read, never one per row (order_addresses_order_unique serves `order_id IN`). An order with no row
// keeps a nil Address, which the mapper reads as an empty customer and address.
func attachAddresses(tx *gorm.DB, orders []selling_service_models.Order) error {
	if len(orders) == 0 {
		return nil
	}

	ids := make([]uint64, 0, len(orders))
	for i := range orders {
		ids = append(ids, orders[i].ID)
	}

	var rows []selling_service_models.OrderAddress

	err := tx.
		Where("order_id IN ?", ids).
		Find(&rows).
		Error
	if err != nil {
		return err
	}

	byOrder := make(map[uint64]*selling_service_models.OrderAddress, len(rows))
	for i := range rows {
		byOrder[rows[i].OrderID] = &rows[i]
	}

	for i := range orders {
		orders[i].Address = byOrder[orders[i].ID]
	}

	return nil
}

// attachAddress is attachAddresses for one order.
func attachAddress(tx *gorm.DB, order *selling_service_models.Order) error {
	one := []selling_service_models.Order{*order}

	err := attachAddresses(tx, one)
	if err != nil {
		return err
	}

	order.Address = one[0].Address

	return nil
}
