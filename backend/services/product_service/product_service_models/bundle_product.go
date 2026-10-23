package product_service_models

// BundleProduct is a row of `bundle_products` — one product of a bundle, and how many of it go into ONE bundle
// (a-bundle-line-carries-its-quantity). Whose product it is comes from products.team_id, never a copy here
// (a-bundle-line-reads-its-owner-from-the-product).
type BundleProduct struct {
	ID        uint64 `gorm:"primaryKey"`
	BundleID  uint64
	ProductID uint64
	Quantity  uint32
}

func (BundleProduct) TableName() string {
	return "bundle_products"
}
