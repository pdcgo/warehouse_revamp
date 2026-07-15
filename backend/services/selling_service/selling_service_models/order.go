package selling_service_models

import "time"

// Order is a row of `orders` — the selling side of one order (#67): who ordered, from which shop,
// and the frozen money (whole rupiah). Fulfillment is not modelled here. Schema owned by goose;
// GORM only reads/writes rows.
type Order struct {
	ID     uint64 `gorm:"primaryKey"`
	TeamID uint64
	ShopID uint64

	// The OrderStatus enum stored as text ("placed", …) — mapped in selling_v1/order_mapper.go. No
	// DB CHECK (the mapper + proto validation guard it; cf. #80).
	Status string

	CustomerName    string
	CustomerPhone   string
	CustomerAddress string
	// A shipping_service courier code (opaque).
	ShippingCode string

	// Frozen money, whole rupiah.
	Subtotal     int64
	ShippingCost int64
	Total        int64

	// The lines; loaded on demand (OrderDetail).
	Items []OrderItem `gorm:"foreignKey:OrderID"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Order) TableName() string {
	return "orders"
}
