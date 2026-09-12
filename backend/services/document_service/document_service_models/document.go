package document_service_models

import "time"

// Document is a row of `documents` — metadata for one stored file. The bytes live in object storage;
// this row only tracks where and what. Schema owned by goose (db_migrations); no AutoMigrate.
type Document struct {
	ID           string `gorm:"primaryKey"`
	TeamID       uint64
	ResourceType string
	ObjectKey    string
	MimeType     string
	SizeBytes    int64
	Filename     string
	CreatedByID  uint64
	Status       string
	PublicURL    string
	ThumbnailKey string
	ThumbnailURL string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func (Document) TableName() string {
	return "documents"
}
