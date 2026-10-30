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

	// THE BUYER'S USERNAME on the marketplace (00021, the-buyers-username-is-optional) — the name the buyer goes by in
	// the marketplace chat. Not CustomerName, which is who the parcel is addressed to. Trimmed at placement; '' = none,
	// which is a valid order on both doors.
	BuyerUsername string

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
	// A courier code (opaque) — a shipment_service channel's `code`. Moves to shipment_channel_id with
	// the order redesign (the-old-catalogue-bridges-by-code).
	ShippingCode string

	// THE MARKETPLACE'S OWN ID for this order (owner) — read off the storefront and typed in beside
	// the shop that took it. The only name this order has that a buyer, a payout report or the
	// marketplace's support can be asked about; `ID` above means nothing to any of them.
	//
	// Stored verbatim, never parsed. "" = no marketplace reference, the ordinary state of an order
	// taken over the phone.
	//
	// ⚠ NOT unique and nothing joins on it — whether two orders may share one is still open. It is
	// evidence of where an order came from, not a key.
	OrderExternalRefID string

	// THE ORDER'S MONEY — the owner's three header figures (00027), and nothing else: no subtotal, no shipping
	// (an-order-records-no-shipping-cost).
	//
	// GoodsCost is the owner's `goods_cost`: Σ the lines' frozen Total — a borrowed line WITH its owner's markup, what
	// the goods cost the seller (the-cross-charge-lives-on-the-line) — rounded once to whole rupiah. The warehouse fee
	// is priced on it (the-fee-is-priced-on-goods-cost). Denormalised onto the header because OrderList returns a
	// summary without lines. 0 means unknown, not free.
	GoodsCost int64
	// The owner's `total_cost`: GoodsCost + WarehouseFee, frozen beside them — what the order cost the seller ("total
	// beli"). Unrounded rupiah, like the fee. A never-priced fee counts as nothing here.
	TotalCost float64

	// WHAT THE BUYER PAID on the platform — the owner's `platform_total` (00026,
	// the-total-is-ours-the-platform-total-is-theirs): what the storefront actually took once its vouchers and
	// subsidies had been applied. A fact read off the storefront, required at placement since 00022; 0 = not recorded,
	// on an order placed before that. margin = PlatformTotal − TotalCost.
	PlatformTotal int64

	// The SHIPPING RECEIPT attached to this order (owner) — the courier's slip or the marketplace's
	// PDF. A REFERENCE to a document_service document: the id is opaque (no FK across services), and
	// the two labels are a snapshot of what the file was called and what kind of file it is, so a row
	// can be rendered without calling document_service. '' = no receipt.
	//
	// The document is private; viewing it is a GetDownloadUrl call scoped to the team.
	ReceiptDocumentID string
	ReceiptFilename   string
	ReceiptMimeType   string

	// THE TRACKING NUMBER printed on that slip (00018) — the owner's `orders.receipt`: what a buyer chases a parcel by
	// and what a label scan matches beside the marketplace ref (a-label-scan-reads-the-ref-or-the-receipt). Verbatim,
	// never parsed. '' = not recorded. The proto calls it `receipt_code`, because `receipt` there is the file.
	Receipt string

	// THE WAREHOUSE'S FEE, frozen at create (00019, the-flat-rate-is-dropped-last step 3): WarehouseFeeCalculate on the
	// goods cost, never recomputed. Unrounded rupiah (rupiah-is-floating-point).
	//
	// ⚠ nil is NEVER PRICED — an order placed before fees were frozen. 0 is a warehouse that chose to charge nothing.
	WarehouseFee *float64

	// THE PLATFORM'S TWO DATES (00020). PlatformCreatedAt is when the buyer ordered on the storefront — required when an
	// order is placed (platform-created-at-is-required-at-finalize), nil only on orders placed before the column.
	// PlatformShipmentDeadline is the marketplace's ship-by time, optional (the-shipment-deadline-is-the-platforms-and-optional).
	PlatformCreatedAt        *time.Time
	PlatformShipmentDeadline *time.Time

	// ⚠ NO NOTE COLUMN. An order's notes are rows of its timeline with no status (a-note-is-a-timeline-row) — the note
	// typed at placement is the first of them. Selling 00029 moved the old `note` column into those rows and dropped it.

	// WHO CREATED THE ORDER (00013) — read from the authenticated caller at placement, never from the
	// request, and never updated. settlement_service stamps it onto the order's account. 0 = not
	// recorded.
	CreatedByUserID uint64

	// HOW MANY UNITS — the sum of the lines' quantities (the-warehouse-row-fills-from-shop-and-user-by-ids). Not a
	// column: OrderList selects it with a subquery, and OrderDetail sums the lines it loads. Read-only to GORM.
	ItemQuantity int64 `gorm:"->;-:migration"`

	// WHEN IT ENTERED ITS CURRENT STATUS — the newest timeline row moving it into Status
	// (a-filtered-status-shows-its-own-date). Not a column: OrderList selects it with a subquery, OrderDetail reads it
	// off the timeline it loads. nil = no row records the move. Read-only to GORM.
	StatusAt *time.Time `gorm:"->;-:migration"`

	// WHEN IT FIRST ENTERED THE STATUS THE LIST'S DATE FILTER READS (the-order-list-filters-by-seven-dates). Not a
	// column: OrderList selects it only when the filter dates a status. nil = not asked, or no row records it.
	DateEnteredAt *time.Time `gorm:"->;-:migration"`

	// The lines; loaded on demand (OrderDetail).
	Items []OrderItem `gorm:"foreignKey:OrderID"`

	// The order's timeline, oldest first; loaded on demand (OrderDetail), like Items
	// (order-timeline-logs-replaces-order-events).
	//
	// ⚠ The timeline is the HISTORY; `Status` above is the CURRENT STATE, and both are kept. The list
	// filters, sorts and counts on the column — which a child table cannot do cheaply — while the
	// timeline reads these. Neither is derivable from the other: the column cannot say when or by whom,
	// and rebuilding "where is it now" by replaying rows on every list query would be absurd.
	TimelineLogs []OrderTimelineLog `gorm:"foreignKey:OrderID"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Order) TableName() string {
	return "orders"
}
