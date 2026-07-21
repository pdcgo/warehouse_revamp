package inventory_service_models

import "time"

// RestockRequest is a row of `restock_requests` (#105/#124) — a selling team's request for a
// warehouse to restock, with shipment info. Schema owned by goose (db_migrations); GORM only reads
// and writes rows.
//
// requesting_team_id / warehouse_id / order_id are OPAQUE cross-service ids (no FK); scope is
// enforced by the access interceptor, not the DB. `status` is stored as text (mapped in the handler
// layer — no DB CHECK IN-list, cf. #80). A request carries MANY priced lines (#124) — see
// RestockRequestItem.
type RestockRequest struct {
	ID               uint64 `gorm:"primaryKey"`
	RequestingTeamID uint64
	WarehouseID      uint64
	ShippingCode     string
	Status           string

	// Optional context (#124/#127). OrderRef is the order this restock is FOR, as free text — it is
	// written down from a marketplace or a chat elsewhere, never a row here, so it is a reference and
	// not an id. Receipt is the courier's tracking number (resi), empty until there is one.
	// SupplierID points at a supplier of the REQUESTING team — suppliers is the same service, so
	// unlike the opaque ids above it is a real FK; nil when none was recorded.
	OrderRef   string
	Receipt    string
	SupplierID *uint64

	// #127. ShippingCost is the freight, whole rupiah — the goods' cost is per line (Item.Price), and
	// this is what the summary adds on top. PaymentType is stored as text and mapped in the handler
	// layer (no DB CHECK IN-list, cf. #80).
	ShippingCost int64
	// The courier fee paid AT THE DOOR (#155) — entered by the warehouse when it accepts, because it
	// is the side that pays it and it only exists once the goods turn up. Summed with ShippingCost and
	// spread across the units that arrived sellable.
	CODShippingFee int64 `gorm:"column:cod_shipping_fee"`
	PaymentType  string
	Note         string

	// The lines. GORM loads them via RestockRequestID.
	Items []RestockRequestItem `gorm:"foreignKey:RestockRequestID"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (RestockRequest) TableName() string {
	return "restock_requests"
}

// RestockRequestItem is a row of `restock_request_items` (#124) — one product on a request, how much
// of it, and what it is expected to cost.
//
// sku/name are SNAPSHOTS taken at request time: the product may live in another team's catalogue and
// may be renamed or deleted later, and the request must keep reading as it was raised.
type RestockRequestItem struct {
	ID               uint64 `gorm:"primaryKey"`
	RestockRequestID uint64
	// Opaque product_service id — no FK.
	ProductID uint64
	SKU       string
	Name      string
	// Quantity is what was ASKED FOR; ReceivedQuantity is what actually turned up.
	Quantity int64
	// Whole rupiah, THE LINE TOTAL (#140) — what the whole line cost, not one piece.
	//
	// Stored as the total because that is the number a person reads off an invoice and types. Any
	// per-unit figure is DERIVED (see StockCost) and is openly a rounding: 10.000 over 3 pieces is
	// 3.333 a piece, and the rupiah that division drops must never be written back over the 10.000.
	TotalPrice int64

	// What the warehouse COUNTED when it accepted the request (#133) — the number stock actually
	// receives. Kept alongside Quantity rather than replacing it: the gap between asked and arrived is
	// the record's whole value, and overwriting the ask would erase the discrepancy. 0 until accepted,
	// and 0 for a line that never turned up, so it only means anything once Status is fulfilled.
	ReceivedQuantity int64

	// WHERE the goods went and WHAT arrived broken (#154). Loaded with the line; written only by the
	// warehouse as it accepts.
	Placements []RestockReceivedPlacement `gorm:"foreignKey:RestockRequestItemID"`
	Damaged    []RestockDamagedUnit       `gorm:"foreignKey:RestockRequestItemID"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (RestockRequestItem) TableName() string {
	return "restock_request_items"
}

// RestockReceivedPlacement is a row of `restock_received_placements` (#154) — how many of a received
// line's units went to ONE place.
//
// A line carries a LIST of these, because a delivery of 100 does not go on one shelf. They must sum to
// the line's ReceivedQuantity; the handler refuses anything else rather than interpreting it.
type RestockReceivedPlacement struct {
	ID                   uint64 `gorm:"primaryKey"`
	RestockRequestItemID uint64
	// nil is the UNPLACED PILE (#135) — "received, not shelved yet". A real place, not a missing
	// answer: it is what a partial put-away looks like.
	RackID    *uint64
	Quantity  int64
	CreatedAt time.Time
}

func (RestockReceivedPlacement) TableName() string {
	return "restock_received_placements"
}

// RestockDamagedUnit is a row of `restock_damaged_units` (#154) — units that arrived broken or never
// arrived at all.
//
// They NEVER ENTER STOCK (owner, 2026-07-20): ReceivedQuantity counts what is sellable, and this counts
// what is not, so nobody can pick a box that is already crushed. Rows rather than a note on the line,
// because the point is that breakage is a NUMBER something can total — "what does this supplier cost us
// in damage" only has an answer if the losses were counted.
type RestockDamagedUnit struct {
	ID                   uint64 `gorm:"primaryKey"`
	RestockRequestItemID uint64
	Quantity             int64
	// Required and non-empty (DB CHECK). A loss with no reason is a number nobody can act on.
	Reason string
	// What those units were worth, whole rupiah. 0 is legitimate — a free sample can arrive crushed.
	Value     int64
	CreatedAt time.Time
}

func (RestockDamagedUnit) TableName() string {
	return "restock_damaged_units"
}
