package settlement_importer_service_models

import "time"

// UploadedFile is a row of `uploaded_files` — one uploaded platform statement. Schema owned by goose
// (db_migrations); GORM only reads and writes rows.
//
// ⚠ Nothing on it is unique but the id (the-row-key-is-the-only-dedupe): the same file twice is two rows.
type UploadedFile struct {
	ID     uint64 `gorm:"primaryKey"`
	TeamID uint64
	ShopID uint64

	// "shopee" or "tiktok" — san_marketplace's text. The shop's marketplace picks it.
	Platform string

	DocumentID    string
	ContentSha256 string `gorm:"column:content_sha256"`

	// The statement's own range. nil until the file has been read.
	PeriodFrom *time.Time `gorm:"type:date"`
	PeriodTo   *time.Time `gorm:"type:date"`

	// running · done · failed. INTERRUPTED is worked out when read, never stored.
	Status  string
	Failure string

	RowsTotal        int
	RowsPosted       int
	RowsExisting     int
	RowsHeld         int
	RowsSkipped      int
	RowsPostedToShop int

	// The uploader — the actor on every row this file posts.
	CreatedByUserID uint64
	// The shop's primary CS when the file was checked.
	PrimaryUserID uint64

	CreatedAt time.Time
	// Moves with the tallies — a running row that stops moving reads interrupted.
	UpdatedAt  time.Time
	FinishedAt *time.Time
}

func (UploadedFile) TableName() string {
	return "uploaded_files"
}
