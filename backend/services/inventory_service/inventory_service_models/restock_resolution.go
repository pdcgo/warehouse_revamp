package inventory_service_models

import "time"

// RestockResolutionType is what a resolution row is (a-restock-problem-is-settled-by-resolution-rows).
type RestockResolutionType string

const (
	// RestockResolutionRefund is money back into the account the row names.
	RestockResolutionRefund RestockResolutionType = "refund"
	// RestockResolutionReturn is the broken goods sent back to the supplier — an outbound reship parcel.
	RestockResolutionReturn RestockResolutionType = "return"
	// RestockResolutionReshipping is the supplier sending the goods again — an inbound parcel.
	RestockResolutionReshipping RestockResolutionType = "reshipping"
)

// RestockResolution is a row of `restock_resolutions` (00060, the owner's restock.md §Table Should We Have In Restock,
// item 4) — one way a problem or lost restock was settled: its type, a refund's amount and the account it went into, the
// selling team's note, who recorded it and when. A restock takes as many as it needs; a row names no units. APPEND ONLY.
type RestockResolution struct {
	ID             uint64 `gorm:"primaryKey"`
	RestockID      uint64
	ResolutionType RestockResolutionType

	// REFUND only — above 0, and the selling team's account it went into (an opaque financial_account_service id). 0 and
	// 0 on another type (the table's shape check).
	RefundAmount     float64
	FinanceAccountID uint64
	Note             string

	// The form's key for this one record — unique per restock (a double tap would record a refund twice).
	IdempotencyKey string

	// Who recorded it (from the caller's identity) and whether as Root / the Administrator from outside the team.
	CreatedByUserID     uint64
	CreatedByIsOverride bool
	CreatedAt           time.Time
}

func (RestockResolution) TableName() string {
	return "restock_resolutions"
}
