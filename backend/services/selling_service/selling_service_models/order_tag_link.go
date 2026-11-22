package selling_service_models

import "time"

// OrderTagLink is a row of `order_tag_links` (00055) — one order tag on one order (backlog #100). An order's tags are ONE
// set, the same for its selling team and the warehouse that ships it (orders-have-their-own-tag-list, its 🔄 "A"); the
// pair is the key, so a tag is on an order once. Deleting a tag takes it off every order (ON DELETE CASCADE, under the
// tag's row lock).
//
// Who put it on, and when: an opaque user_service id and whether that person was an override
// (an-override-is-stamped-in-every-service).
type OrderTagLink struct {
	OrderID uint64 `gorm:"primaryKey;autoIncrement:false"`
	TagID   uint64 `gorm:"primaryKey;autoIncrement:false"`

	AddedByUserID     uint64
	AddedByIsOverride bool
	AddedAt           time.Time
}

func (OrderTagLink) TableName() string {
	return "order_tag_links"
}
