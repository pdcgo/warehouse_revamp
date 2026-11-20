package inventory_service_models

import "time"

// CustomShipmentLogKind is what a trail row is (00059): a step, a cost edit, or a goods-missing note.
type CustomShipmentLogKind string

const (
	// CustomShipmentLogStatus is the create's row or a status move — from differs from to.
	CustomShipmentLogStatus CustomShipmentLogKind = "status"
	// CustomShipmentLogCostEdit is *Ubah Ongkir* — from equals to; the description names the team's cost.
	CustomShipmentLogCostEdit CustomShipmentLogKind = "cost_edit"
	// CustomShipmentLogGoodsMissing is the warehouse's *Barang tidak ketemu* — from = to = requested, its lines in
	// `custom_shipment_missing_lines`, its note the description (missing-goods-leave-a-note-on-the-custom-shipment).
	CustomShipmentLogGoodsMissing CustomShipmentLogKind = "goods_missing"
)

// CustomShipmentLog is a row of `custom_shipment_logs` (00057, its kind 00059) — one status change, one cost edit (a
// row whose from equals its to), or one goods-missing note, as every-transfer-status-change-is-logged. FromStatus is
// empty on the create's row.
type CustomShipmentLog struct {
	ID               uint64 `gorm:"primaryKey"`
	CustomShipmentID uint64
	Kind             CustomShipmentLogKind
	FromStatus       CustomShipmentStatus
	ToStatus         CustomShipmentStatus
	ActorUserID      uint64
	// Root or the Administrator acting in a team they hold no role in (an-override-is-stamped-in-every-service).
	IsOverride  bool
	Description string
	CreatedAt   time.Time
}

func (CustomShipmentLog) TableName() string {
	return "custom_shipment_logs"
}
