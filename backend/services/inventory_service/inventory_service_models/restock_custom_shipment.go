package inventory_service_models

import "time"

// RestockCustomShipment is a row of `restock_custom_shipments` (00060, the owner's own table —
// a-suppliers-reshipping-comes-in-as-a-custom-shipment): it joins a restock, its resolution row, the custom shipment that
// row rides — a `return` going out, a `reshipping` coming in — and the stock movement the parcel made: a reshipping's
// stock-in at its Terima, none for a return (its broken units are on no rack). One per resolution, one per parcel.
type RestockCustomShipment struct {
	ID               uint64 `gorm:"primaryKey"`
	RestockID        uint64
	ResolutionID     uint64
	CustomShipmentID uint64
	// NULL until a reshipping's Terima counts good units in; always NULL on a return.
	InventoryTransactionID *uint64
	CreatedAt              time.Time
}

func (RestockCustomShipment) TableName() string {
	return "restock_custom_shipments"
}
