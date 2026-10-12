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

	// Whole rupiah.
	Change     int64
	OccurredOn *time.Time `gorm:"type:date"`

	// 0 = the shop.
	OrderID uint64

	// posted · existing · held · skipped, and why.
	Outcome string
	Reason  string
	Detail  string

	SettlementLogID uint64

	CreatedAt time.Time
}

func (UploadedFileLine) TableName() string {
	return "uploaded_file_lines"
}
