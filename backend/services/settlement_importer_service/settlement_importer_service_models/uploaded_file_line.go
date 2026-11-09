package settlement_importer_service_models

import "time"

// UploadedFileLine is a row of `uploaded_file_lines` — one line an uploaded statement yielded, and what
// became of it. Written once, as the import reaches it.
type UploadedFileLine struct {
	ID             uint64 `gorm:"primaryKey"`
	UploadedFileID uint64

	// Its place in the order the file was read — the stream's step.
	LineNo int

	Sheet string

	// The ledger key it posted under, or would have.
	UniqueID string

	OrderRef     string
	PlatformType string
	Description  string

	// settlement's text for what it became — "" when the platform's type is not mapped.
	SettlementType string

	// Rupiah, a double since 00004 — whole: a fractional line is held with 0 here.
	Change     float64
	OccurredOn *time.Time `gorm:"type:date"`

	// 0 = the shop.
	OrderID uint64

	// posted · existing · held · skipped, and why.
	Outcome string
	Reason  string
	Detail  string

	SettlementLogID uint64

	// several_orders: every live order the ref found in the shop, comma-joined, ascending (00003,
	// two-live-orders-on-a-ref-post-to-the-shop). '' otherwise.
	FoundOrderIDs string `gorm:"column:found_order_ids"`

	CreatedAt time.Time
}

func (UploadedFileLine) TableName() string {
	return "uploaded_file_lines"
}
