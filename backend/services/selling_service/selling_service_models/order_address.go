package selling_service_models

import "time"

// OrderAddress is a row of `order_addresses` (00045) — the owner's table: WHO the parcel is for and WHERE it goes, as
// plain names a courier reads (an-address-is-plain-names). No region_service codes: the picker's codes are discarded on
// write, and the names are frozen, so a past order reads the same after a desa is renamed upstream.
//
// EXACTLY ONE per order (one-address-per-order-and-per-draft): `order_id` is UNIQUE and the row is written in the order's
// own transaction, so an order without one is never reachable. A correction updates this row; there is no history.
// CustomerName is required here (CHECK order_addresses_customer_present) — the guarantee `orders` carried until 00045.
type OrderAddress struct {
	ID      uint64 `gorm:"primaryKey"`
	OrderID uint64

	CustomerName  string
	CustomerPhone string

	ProvinsiName  string
	KabupatenName string
	KecamatanName string
	DesaName      string
	// The postcode as chosen — editable in the picker, so not necessarily the dataset's. `kode_pos` on the wire.
	PostalCode string
	// Jalan, no. rumah, RT/RW — the free text no dataset supplies.
	AddressLine string

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (OrderAddress) TableName() string {
	return "order_addresses"
}
