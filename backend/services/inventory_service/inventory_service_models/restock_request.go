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

	// OrderRef holds the store's INVOICE reference (a-restock-keeps-its-invoice-reference, a-restock-has-one-invoice);
	// the column takes its decided name, invoice_ref_id, with the table rename. Receipt is the courier's tracking
	// number (the-receipt-is-the-tracking-number) and ReceiptFile a photo of the label. ShipmentID is the courier, an
	// opaque shipment_service channel id; 0 = not named.
	OrderRef    string
	Receipt     string
	ReceiptFile string
	ShipmentID  uint64

	// The selling team's account that paid (a-restock-names-its-paying-account) — an opaque financial_account_service
	// id. 0 only on a restock raised before it was required.
	FinanceAccountID uint64

	// The accept's inventory transaction (every-stock-change-belongs-to-a-transaction). 0 until the accept writes the
	// ledgers (the-decided-ledgers-come-before-the-restock-accept).
	TransactionID uint64

	// #127. ShippingCost is the freight, whole rupiah — the goods' cost is per line (Item.Price), and
	// this is what the summary adds on top. PaymentType is stored as text and mapped in the handler
	// layer (no DB CHECK IN-list, cf. #80).
	ShippingCost int64
	// The courier's charge at the door (the-warehouse-cost-is-the-couriers-charge-at-the-door): ONE per restock, with
	// its note (the-courier-is-paid-once-per-restock), entered by the warehouse at accept. Outside the total
	// (the-couriers-charge-stays-out-of-total), inside the unit price (the-couriers-ask-is-in-the-unit-price).
	WarehouseAdditionalCost     int64
	WarehouseAdditionalCostNote string
	PaymentType                 string
	// The selling team's note on the whole restock (three-notes-one-writer-each).
	Note string

	// WHO handled it, as opaque user_service ids (no FK, like the team ids above). Both 0 until the
	// act happens — and 0 on any row raised before 00018, which is deliberately not backfilled: a
	// guessed id would put a real person's name against work they may not have done.
	//
	// Set from the CALLER'S IDENTITY in the handler, never from the request body.
	CreatedByUserID  uint64
	AcceptedByUserID uint64
	// Who called it off (00019). 0 until it is cancelled — and 0 forever on a row cancelled before
	// that migration, for the same reason the two above are: a guessed id is worse than none.
	CancelledByUserID uint64
	// Who signed for the box, and who gave up on it (the-warehouse-signs-and-accepts-the-team-does-the-rest).
	ArrivedByUserID uint64
	LostByUserID    uint64

	// WHEN it was accepted / cancelled. Pointers because "has not been" is a real state and NULL is
	// how the column says it — a zero time.Time would read as the first second of year 1, which sorts
	// and filters as a date somebody could actually ask about.
	AcceptedAt  *time.Time
	CancelledAt *time.Time
	ArrivedAt   *time.Time
	LostAt      *time.Time

	// The lines. GORM loads them via RestockRequestID.
	Items []RestockRequestItem `gorm:"foreignKey:RestockRequestID"`

	// The TRAIL (00024) — every status change and edit, oldest first (every-status-change-is-logged). Preloaded by
	// Detail only: a page of twenty restocks has no use for every log of each, exactly as it has none for the lines'
	// placements.
	Logs []RestockLog `gorm:"foreignKey:RestockRequestID"`

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

	// Who sold this line, and through which store (a-line-names-the-channel-it-was-bought-from,
	// a-line-may-name-a-supplier-without-a-channel): opaque supplier_service ids, both optional, the store one of the
	// supplier's. Note is the selling team's word on the line, e.g. "extra stock" (three-notes-one-writer-each).
	SupplierID        *uint64
	SupplierChannelID *uint64
	Note              string

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
	// The warehouse's note on these units — optional (a-broken-reason-is-optional, three-notes-one-writer-each).
	Reason string
	// "broken" or "missing" (a-short-unit-at-the-door-is-missing). Stored as text and mapped in the handler layer (no DB
	// CHECK IN-list, cf. #80).
	DamageType string
	// What each unit was worth, FILLED BY THE SYSTEM at accept, never typed (the-problem-price-is-filled-by-the-system):
	// the landed unit price, the same as a good unit's (all-qty-is-every-unit-ordered). Total = PriceUnit × Quantity.
	PriceUnit int64
	Total     int64
	CreatedAt  time.Time
}

func (RestockDamagedUnit) TableName() string {
	return "restock_damaged_units"
}
