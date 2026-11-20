package inventory_service_models

import "time"

// CustomShipmentKind is what a parcel is (a-custom-shipment-is-a-parcel-that-is-not-an-order).
type CustomShipmentKind string

const (
	// CustomShipmentSample is the owning team's units sent to someone, taken from stock at create.
	CustomShipmentSample CustomShipmentKind = "sample"
	// CustomShipmentReship is a received restock's broken units sent back to its supplier — no stock moves.
	CustomShipmentReship CustomShipmentKind = "restock_reship"
)

// CustomShipmentStatus is where a parcel is.
type CustomShipmentStatus string

const (
	CustomShipmentRequested  CustomShipmentStatus = "requested"
	CustomShipmentPicked     CustomShipmentStatus = "picked"
	CustomShipmentHandedOver CustomShipmentStatus = "handed_over"
	CustomShipmentCancelled  CustomShipmentStatus = "cancelled"
)

// CustomShipmentPayer is who pays the courier (the-courier-is-paid-by-the-team-or-by-the-warehouse).
type CustomShipmentPayer string

const (
	// CustomShipmentPayerTeam is *Kami bayar* — the selling team, from one of its accounts, posted as an expense.
	CustomShipmentPayerTeam CustomShipmentPayer = "team"
	// CustomShipmentPayerWarehouse is *Gudang bayar* — the warehouse pays at the handover, owed back through Team Balance.
	CustomShipmentPayerWarehouse CustomShipmentPayer = "warehouse"
)

// CustomShipment is a row of `custom_shipments` (00057) — a parcel the warehouse sends that is not a marketplace order:
// a sample of the owning team's units, or a received restock's broken units back to its supplier. A sample's units
// leave the books at create, in ITS transaction (TransactionID); a reship moves no stock. Schema owned by goose; GORM
// only reads and writes rows.
//
// team_id / warehouse_id / supplier_id / shipment_channel_id / finance_account_id are OPAQUE cross-service ids (no FK).
type CustomShipment struct {
	ID          uint64 `gorm:"primaryKey"`
	TeamID      uint64
	WarehouseID uint64
	Kind        CustomShipmentKind
	Status      CustomShipmentStatus

	// A reship's restock and its lines' supplier (0 = the lines named none); 0 on a sample.
	RestockID  uint64
	SupplierID uint64

	// Who receives it — free text.
	RecipientName    string
	RecipientPhone   string
	RecipientAddress string

	ShipmentChannelID uint64
	Payer             CustomShipmentPayer
	// TEAM payer: the team's account (required) and cost. WAREHOUSE payer: no account; the cost typed at the handover.
	FinanceAccountID uint64
	ShippingCost     float64
	// Bumped by every cost edit that moves money, so each edit's event has its own id.
	CostRevision uint64
	Resi         string
	Note         string

	// A sample's stock take; nil on a reship.
	TransactionID *uint64
	// A sample's value — Σ its lines, at the batches the take drew from; 0 on a reship.
	Total float64

	// The form's key for the create — UNIQUE per team.
	IdempotencyKey string

	// Who did what, and when. 0 / nil = not yet.
	CreatedByUserID    uint64
	PickedByUserID     uint64
	PickedAt           *time.Time
	HandedOverByUserID uint64
	HandedOverAt       *time.Time
	CancelledByUserID  uint64
	CancelledAt        *time.Time

	Items []CustomShipmentItem `gorm:"foreignKey:CustomShipmentID"`
	// The trail, oldest first. Preloaded by Detail only.
	Logs []CustomShipmentLog `gorm:"foreignKey:CustomShipmentID"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (CustomShipment) TableName() string {
	return "custom_shipments"
}
