package selling_service_models

import "time"

// OrderDraftAddress is a row of `order_draft_addresses` (00046) — a draft's buyer and where the parcel goes, mirroring
// OrderAddress field for field (a-draft-carries-the-scraped-address) as plain NAMES (an-address-is-plain-names): no
// region_service codes are kept, so a scraped address is stored as the app read it and a person's correction as typed.
//
// EXACTLY ONE per draft (one-address-per-order-and-per-draft): `order_draft_id` is UNIQUE and the row is written in the
// draft's own transaction — OrderDraftPush creates it with the draft, a re-push and OrderDraftUpdate update it. BEST
// EFFORT, unlike an order's: every field may be empty, because a draft is defined by being incomplete.
type OrderDraftAddress struct {
	ID           uint64 `gorm:"primaryKey"`
	OrderDraftID uint64

	CustomerName  string
	CustomerPhone string

	ProvinsiName  string
	KabupatenName string
	KecamatanName string
	DesaName      string
	// The postcode as the app read it or a person typed it. `kode_pos` on the wire.
	PostalCode string
	// Jalan, no. rumah, RT/RW — and where a scrape that could not split the region tiers puts the whole text.
	AddressLine string

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (OrderDraftAddress) TableName() string {
	return "order_draft_addresses"
}
