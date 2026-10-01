package product_service_models

import "time"

// ProductImage is a row of `product_images` — one catalogue image belonging to a product. The URL
// and thumbnail are produced by the two-phase document_service upload and stored verbatim; Position
// preserves gallery order (0 = cover). Schema owned by goose; GORM only reads/writes rows.
type ProductImage struct {
	ID           uint64 `gorm:"primaryKey"`
	ProductID    uint64
	URL          string `gorm:"column:url"`
	ThumbnailURL string `gorm:"column:thumbnail_url"`
	Position     int
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func (ProductImage) TableName() string {
	return "product_images"
}
