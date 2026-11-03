package inventory_service_models

import "time"

// OpnameSurplusDraft is a row of `opname_surplus_drafts` — a rack counted over its book, the number the system's and the
// reason the counter's (a-surplus-draft-is-counted-by-the-system). Finalize does not post it: it posts the product's net.
type OpnameSurplusDraft struct {
	ID                uint64 `gorm:"primaryKey"`
	WarehouseID       uint64
	TeamID            uint64
	ProductID         uint64
	PlacementID       uint64
	OpnameSessionID   uint64
	Note              string
	SurplusStockCount int64
	CreatedAt         time.Time
}

func (OpnameSurplusDraft) TableName() string {
	return "opname_surplus_drafts"
}
