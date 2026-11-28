package product_service_models

import "time"

// ProductReprintWait is a row of `product_reprint_waits` — one warehouse that holds stock of a product whose code changed,
// and so must print it new labels (backlog #149; products-have-their-own-tag-list, its 🔄 *what clears*: the tag stays
// until EACH warehouse holding stock has printed). Written by the team code change for every warehouse with units of the
// product on a shelf; read and cleared by that warehouse's reprint (backlog #151). While a product has a row here it
// carries `need_reprint_code`.
type ProductReprintWait struct {
	ProductID   uint64 `gorm:"primaryKey"`
	WarehouseID uint64 `gorm:"primaryKey"`
	// Since when it has waited — the change that asked for the reprint.
	Since time.Time
}

func (ProductReprintWait) TableName() string {
	return "product_reprint_waits"
}
