package product_service_models

import "time"

// ProductTagLink is a row of `product_tag_links` (00010) — one product tag on one product (backlog #147). A product's
// tags are ONE set, read alike by its owning team and every warehouse holding it (products-have-their-own-tag-list, its
// 🔄 *who sees*); the pair is the key, so a tag is on a product once. Deleting a tag takes it off every product, and
// deleting a product takes its tags with it (ON DELETE CASCADE both ways).
//
// Who put it on, and when: an opaque user_service id (0 = the app) and whether that person was an override
// (an-override-is-stamped-in-every-service).
type ProductTagLink struct {
	ProductID uint64 `gorm:"primaryKey;autoIncrement:false"`
	TagID     uint64 `gorm:"primaryKey;autoIncrement:false"`

	AddedByUserID     uint64
	AddedByIsOverride bool
	AddedAt           time.Time
}

func (ProductTagLink) TableName() string {
	return "product_tag_links"
}
