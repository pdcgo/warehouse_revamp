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

	// CROSS markup: what another team pays OVER our cost when it sells this product on its own
	// order. Basis points (1/100 of a percent) — 1250 = 12.50%, 0 = no markup. An integer because it
	// multiplies money; see the migration for why that matters.
	CrossMarkupBps uint32 `gorm:"column:cross_markup_bps"`

	// LOCKED: true = ours only, no other team may build an order around it (it drops out of
	// ProductDiscover). false = available for cross selling, which is how everything behaved before
	// this column existed.
	CrossLocked bool `gorm:"column:cross_locked"`

	// RESERVED: the hold-back buffer in units — how many are never offered for sale, so that
	// available = on_hand - ReservedStock. A property of the ITEM (set once by the catalogue owner,
	// true wherever it is stocked), which is why it sits here and not on an inventory row. 0 = hold
	// nothing back.
	ReservedStock uint32 `gorm:"column:reserved_stock"`

	Deleted   bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Product) TableName() string {
	return "products"
}
