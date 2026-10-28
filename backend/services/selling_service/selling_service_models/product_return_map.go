package selling_service_models

import "time"

// ProductReturnMap is a row of `product_return_maps` — the team's OWN product a borrowed product comes back as when an
// order of it is returned (the-return-map-is-selling-services-and-read-by-ids). One per team per borrowed product
// (the-map-is-unique-on-its-source), written once and never updated (a-return-map-is-written-once). Schema owned by
// goose (db_migrations).
type ProductReturnMap struct {
	ID     uint64 `gorm:"primaryKey"`
	TeamID uint64

	// The borrowed product — another team's, opaque product_service id.
	SharedProductID uint64
	// The team's own product a return of it becomes — opaque product_service id.
	OwnProductID uint64

	CreatedAt time.Time
	// Mirrors CreatedAt: nothing updates the row.
	UpdatedAt time.Time
}

func (ProductReturnMap) TableName() string {
	return "product_return_maps"
}
