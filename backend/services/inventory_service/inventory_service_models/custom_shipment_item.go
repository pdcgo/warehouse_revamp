package inventory_service_models

import "time"

// CustomShipmentItem is a row of `custom_shipment_items` (00057) — one line of a parcel: one product of a sample, or one
// restock line of a reship, once per parcel. Code and name are snapshots at create.
type CustomShipmentItem struct {
	ID               uint64 `gorm:"primaryKey"`
	CustomShipmentID uint64
	ProductID        uint64
	ProductCode      string
	Name             string
	Quantity         int64
	// A sample line's value at the batches its take drew from; 0 on a reship.
	Total float64
	// A reship's restock line (nil on a sample) and that line's broken note, copied at create.
	RestockItemID *uint64
	BrokenNote    string
	// INBOUND only (00060): the seller's price per unit — it values the stock-in and moves no money; editable until
	// Terima. 0 on an outbound line.
	PriceUnit float64
	// INBOUND, written by Terima: what was in the box (broken included), how many broken, and the rack the good units
	// went on (0 = none). NULL until counted.
	Received  *int64
	Broken    *int64
	RackID    uint64
	CreatedAt time.Time
}

func (CustomShipmentItem) TableName() string {
	return "custom_shipment_items"
}
