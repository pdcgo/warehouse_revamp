package selling_service_models

import "time"

// Order is a row of `orders` — the selling side of one order (#67): who ordered, from which shop,
// and the frozen money (whole rupiah). Fulfillment is not modelled here. Schema owned by goose;
// GORM only reads/writes rows.
type Order struct {
	ID     uint64 `gorm:"primaryKey"`
	TeamID uint64
	ShopID uint64

	// WHICH WAREHOUSE fulfils this order (#72) — chosen per order, stored here rather than inferred
	// from the shop, so a shop's default changing later cannot rewrite where past orders shipped from.
	// Opaque team_service id; no FK. 0 means "recorded before orders named a warehouse" and is not a
	// valid warehouse — the contract requires one on create, so zeros are historical only.
	//
	// #69 takes this order's stock out of THIS warehouse at placement; #70 puts it back on cancel.
	WarehouseID uint64

	// The OrderStatus enum stored as text ("placed", …) — mapped in selling_v1/order_mapper.go. No
	// DB CHECK (the mapper + proto validation guard it; cf. #80).
	Status string

	CustomerName  string
	CustomerPhone string

	// The delivery address, FROZEN at order time (#118) — codes AND names, so a past order renders
	// without region_service and survives a desa being renamed or merged. The codes are opaque
	// region_service ids; no FK (HARD RULE 3). AddressLine is the free text (jalan, no. rumah, RT/RW)
	// that no dataset supplies — it is what the old `customer_address` column held.
	ProvinsiCode  string
	ProvinsiName  string
	KabupatenCode string
	KabupatenName string
	KecamatanCode string
	KecamatanName string
	DesaCode      string
	DesaName      string
	KodePos       string
	AddressLine   string
	// A shipping_service courier code (opaque).
	ShippingCode string

	// Frozen money, whole rupiah.
	Subtotal int64
	// The goods' cost for the whole order, frozen at order time (#74) — the sum of every line's
	// quantity x UnitCost. Denormalised onto the header because OrderList returns a summary without
	// lines. margin = Total - COGS - ShippingCost. 0 means unknown, not free.
	COGS         int64 `gorm:"column:cogs"`
	ShippingCost int64
	Total        int64

	// What the order SOLD FOR on the marketplace — a NOTE, not a term of the sum (owner). `Total`
	// stays Subtotal + ShippingCost; this records what the storefront actually took once its vouchers
	// and subsidies had been applied, which is genuinely a different figure and not a correction of
	// one. 0 = not recorded (an order taken over the phone has no marketplace figure at all).
	//
	// ⚠ Never fold this into margin or revenue — `margin = Total - COGS - ShippingCost` still holds.
	MarketplaceTotal int64

	// The SHIPPING RECEIPT attached to this order (owner) — the courier's slip or the marketplace's
	// PDF. A REFERENCE to a document_service document: the id is opaque (no FK across services), and
	// the two labels are a snapshot of what the file was called and what kind of file it is, so a row
	// can be rendered without calling document_service. '' = no receipt.
	//
	// The document is private; viewing it is a GetDownloadUrl call scoped to the team.
	ReceiptDocumentID string
	ReceiptFilename   string
	ReceiptMimeType   string

	// A free-text note about this order, written by whoever took it (owner). The one column here that
	// nothing in the system reads: it carries the instructions to a PERSON that no structured field
	// holds ("deliver after 5pm", "wrap the glass one"). "" = nothing was written down.
	//
	// ⚠ Never branch on it. It is not a status and not a tag — anything that needs to be queried needs
	// a column of its own.
	Note string

	// The lines; loaded on demand (OrderDetail).
	Items []OrderItem `gorm:"foreignKey:OrderID"`

	// What has happened to this order, oldest first; loaded on demand (OrderDetail), like Items.
	//
	// ⚠ The events are the HISTORY; `Status` above is the CURRENT STATE, and both are kept. The list
	// filters, sorts and counts on the column — which a child table cannot do cheaply — while the
	// timeline reads these. Neither is derivable from the other: the column cannot say when or by whom,
	// and rebuilding "where is it now" by replaying rows on every list query would be absurd.
	Events []OrderEvent `gorm:"foreignKey:OrderID"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Order) TableName() string {
	return "orders"
}
