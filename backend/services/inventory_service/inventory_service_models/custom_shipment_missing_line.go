package inventory_service_models

import "time"

// CustomShipmentMissingLine is a row of `custom_shipment_missing_lines` (00059) — one line of a goods-missing note: a
// parcel line on one rack its sample's take drew from, or a reship's line (RackID 0 — its broken units were never on a
// rack). The note itself is its trail row (CustomShipmentLog, kind goods_missing).
type CustomShipmentMissingLine struct {
	ID                   uint64 `gorm:"primaryKey"`
	CustomShipmentLogID  uint64
	CustomShipmentItemID uint64
	// The take's placement; 0 = no rack.
	RackID    uint64
	Quantity  int64
	CreatedAt time.Time
}

func (CustomShipmentMissingLine) TableName() string {
	return "custom_shipment_missing_lines"
}
