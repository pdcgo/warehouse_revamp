package inventory_service_models

import "time"

// RestockRequest is a row of `restock_requests` (#105) — a selling team's request for a warehouse to
// restock a product, with shipment info. Schema owned by goose (db_migrations); GORM only reads and
// writes rows. requesting_team_id / warehouse_id / product_id are OPAQUE cross-service ids (no FK);
// scope is enforced by the access interceptor, not the DB. `status` is stored as text (mapped in the
// handler layer — no DB CHECK IN-list, cf. #80).
type RestockRequest struct {
	ID               uint64 `gorm:"primaryKey"`
	RequestingTeamID uint64
	WarehouseID      uint64
	ProductID        uint64
	SKU              string
	Name             string
	Quantity         int64
	ShippingCode     string
	Status           string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

func (RestockRequest) TableName() string {
	return "restock_requests"
}
