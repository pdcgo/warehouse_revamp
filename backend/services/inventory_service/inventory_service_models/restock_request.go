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
	Quantity  int64
	// Whole rupiah, PER UNIT.
	Price     int64
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (RestockRequestItem) TableName() string {
	return "restock_request_items"
}
