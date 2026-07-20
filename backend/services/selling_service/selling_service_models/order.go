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
	Subtotal     int64
	ShippingCost int64
	Total        int64

	// The lines; loaded on demand (OrderDetail).
	Items []OrderItem `gorm:"foreignKey:OrderID"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Order) TableName() string {
	return "orders"
}
