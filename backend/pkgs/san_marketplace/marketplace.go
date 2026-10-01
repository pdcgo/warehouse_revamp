// Package san_marketplace maps the shared warehouse.marketplace.v1.Marketplace enum to and from the
// short lowercase TEXT code it is persisted as.
//
// The enum is a shared vocabulary (#120) — a SELLING team's shop lives on a marketplace, and a
// supplier can be reached through a shop on one — and so is its text form. Keeping the mapping in one
// place means the selling (`shops`) and inventory (`supplier_channels`) domains cannot drift to
// different encodings of the same marketplace. The value is stored as TEXT, guarded here (plus proto
// validation), not by a DB CHECK IN-list (the #80 drift trap).
package san_marketplace

import marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"

// The stored codes. UNSPECIFIED (and any unknown value) is the empty string.
const (
	Unspecified = ""
	Shopee      = "shopee"
	Tokopedia   = "tokopedia"
	Lazada      = "lazada"
	Tiktok      = "tiktok"
	Blibli      = "blibli"
	Bukalapak   = "bukalapak"
	Other       = "other"
)

// ToText returns the stored code for a marketplace (empty for UNSPECIFIED or an unknown value).
func ToText(m marketplacev1.Marketplace) string {
	switch m {
	case marketplacev1.Marketplace_MARKETPLACE_SHOPEE:
		return Shopee
	case marketplacev1.Marketplace_MARKETPLACE_TOKOPEDIA:
		return Tokopedia
	case marketplacev1.Marketplace_MARKETPLACE_LAZADA:
		return Lazada
	case marketplacev1.Marketplace_MARKETPLACE_TIKTOK:
		return Tiktok
	case marketplacev1.Marketplace_MARKETPLACE_BLIBLI:
		return Blibli
	case marketplacev1.Marketplace_MARKETPLACE_BUKALAPAK:
		return Bukalapak
	case marketplacev1.Marketplace_MARKETPLACE_OTHER:
		return Other
	default:
		return Unspecified
	}
}

// FromText resolves a stored code back to the enum (UNSPECIFIED for empty or an unknown value).
func FromText(text string) marketplacev1.Marketplace {
	switch text {
	case Shopee:
		return marketplacev1.Marketplace_MARKETPLACE_SHOPEE
	case Tokopedia:
		return marketplacev1.Marketplace_MARKETPLACE_TOKOPEDIA
	case Lazada:
		return marketplacev1.Marketplace_MARKETPLACE_LAZADA
	case Tiktok:
		return marketplacev1.Marketplace_MARKETPLACE_TIKTOK
	case Blibli:
		return marketplacev1.Marketplace_MARKETPLACE_BLIBLI
	case Bukalapak:
		return marketplacev1.Marketplace_MARKETPLACE_BUKALAPAK
	case Other:
		return marketplacev1.Marketplace_MARKETPLACE_OTHER
	default:
		return marketplacev1.Marketplace_MARKETPLACE_UNSPECIFIED
	}
}
