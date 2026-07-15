package product_service_models

import "time"

// Product is a row of `products` — one catalogue item, owned by a team. Schema owned by goose
// (db_migrations); GORM only reads and writes rows (no AutoMigrate).
type Product struct {
	ID          uint64 `gorm:"primaryKey"`
	TeamID      uint64
	SKU         string `gorm:"column:sku"`
	Name        string
	Description string

	// The category this product is filed under (a node in category_service's global taxonomy).
	// Opaque cross-service id — no FK. Required on write; 0 only on legacy rows.
	CategoryID uint64

	// The COVER image, denormalised onto the row so a list can show a picture without joining
	// product_images. Mirrors Images[0]; empty when the product has none.
	DefaultImageURL          string `gorm:"column:default_image_url"`
	DefaultImageThumbnailURL string `gorm:"column:default_image_thumbnail_url"`

	// The full gallery (up to 5), ordered by Position. Loaded on demand (ProductDetail); the list
	// leaves it empty and relies on the denormalised cover above.
	Images []ProductImage `gorm:"foreignKey:ProductID"`

	Deleted   bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Product) TableName() string {
	return "products"
}
