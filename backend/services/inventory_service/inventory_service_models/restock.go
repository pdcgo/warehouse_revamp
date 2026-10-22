package inventory_service_models

import "time"

// Restock is a row of `restocks` (00030, restock.md §Table Should We Have In Restock) — a selling team's parcel to a
// warehouse, with its lines and what it paid. Schema owned by goose (db_migrations); GORM only reads and writes rows.
//
// team_id / warehouse_id / finance_account_id / shipment_id are OPAQUE cross-service ids (no FK); scope is enforced by
// the access interceptor, not the DB. `status` is stored as text (mapped in the handler layer — no DB CHECK IN-list,
// cf. #80). A restock carries MANY priced lines — see RestockItem.
type Restock struct {
	ID          uint64 `gorm:"primaryKey"`
	TeamID      uint64
	WarehouseID uint64
	Status      string

	// The store's invoice reference (a-restock-keeps-its-invoice-reference, a-restock-has-one-invoice). Receipt is the
	// courier's tracking number (the-receipt-is-the-tracking-number) and ReceiptFile a photo of the label. ShipmentID
	// is the courier, an opaque shipment_service channel id; 0 = not named.
	InvoiceRefID string
	Receipt      string
	ReceiptFile  string
	ShipmentID   uint64

	// The selling team's account that paid (a-restock-names-its-paying-account) — an opaque financial_account_service
	// id. 0 only on a restock raised before it was required.
	FinanceAccountID uint64

	// The accept's inventory transaction (every-stock-change-belongs-to-a-transaction). 0 until accepted.
	TransactionID uint64

	// THE MONEY, double (money-is-double-in-the-api-too). ShipmentCost is the freight the selling team paid. Subtotal
	// is Σ line totals and Total adds the freight — both written by every create and edit (restockTotals), never the
	// courier's charge (the-couriers-charge-stays-out-of-total).
	ShipmentCost float64
	Subtotal     float64
	Total        float64

	// The courier's charge at the door (the-warehouse-cost-is-the-couriers-charge-at-the-door): ONE per restock, with
	// its note (the-courier-is-paid-once-per-restock), entered by the warehouse at accept. Outside the total, inside the
	// unit price (the-couriers-ask-is-in-the-unit-price).
	WarehouseAdditionalCost     float64
	WarehouseAdditionalCostNote string

	// How a restock raised before paying accounts was paid for (#127) — read-only history, mapped in the handler layer.
	PaymentType string
	// The selling team's note on the whole restock (three-notes-one-writer-each).
	Note string

	// WHO handled it, as opaque user_service ids (no FK, like the team ids above). 0 until the act happens — and 0 on
	// any row raised before 00018, which is deliberately not backfilled: a guessed id would put a real person's name
	// against work they may not have done.
	//
	// Set from the CALLER'S IDENTITY in the handler, never from the request body.
	CreatedByUserID   uint64
	AcceptedByUserID  uint64
	CancelledByUserID uint64
	// Who signed for the box, and who gave up on it (the-warehouse-signs-and-accepts-the-team-does-the-rest).
	ArrivedByUserID uint64
	LostByUserID    uint64

	// WHEN each act happened. Pointers because "has not been" is a real state and NULL is how the column says it — a
	// zero time.Time would read as the first second of year 1, which sorts and filters as a date somebody could ask
	// about.
	AcceptedAt  *time.Time
	CancelledAt *time.Time
	ArrivedAt   *time.Time
	LostAt      *time.Time

	// The lines. GORM loads them via RestockID.
	Items []RestockItem `gorm:"foreignKey:RestockID"`

	// What did not become stock at the door, keyed by restock and product. Written by the accept; preloaded by Detail
	// and by whoever announces the accept.
	Problems []RestockProblemItem `gorm:"foreignKey:RestockID"`

	// The TRAIL — every status change and edit, oldest first (every-status-change-is-logged). Preloaded by Detail only:
	// a page of twenty restocks has no use for every log of each.
	Logs []RestockLog `gorm:"foreignKey:RestockID"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Restock) TableName() string {
	return "restocks"
}
