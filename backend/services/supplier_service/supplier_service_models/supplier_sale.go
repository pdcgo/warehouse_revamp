package supplier_service_models

import "time"

// PENJUALAN's tables (00004, penjualan-is-the-selling-value-on-the-order-day) — what went out of a supplier's goods to a
// buyer, folded from OrderPlaced and OrderCancelled. Derived, like every figure table here.

// SupplierSaleOrder is a row of `supplier_sale_orders` — one order the sales fold has seen, and on which days. A cancel
// that arrives before its placement leaves CancelledDay with no PlacedDay; the late placement folds both.
type SupplierSaleOrder struct {
	OrderID      uint64 `gorm:"primaryKey"`
	PlacedDay    *time.Time
	CancelledDay *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func (SupplierSaleOrder) TableName() string {
	return "supplier_sale_orders"
}

// SupplierSaleOrderPart is a row of `supplier_sale_order_parts` — what one order added per supplier, product, owning
// team and the warehouse its take drew the units from (00006), kept so its cancel takes back exactly that, there.
// WarehouseID 0 = folded before the warehouse was recorded, until `san supplier backfill-warehouses` re-reads its take.
type SupplierSaleOrderPart struct {
	OrderID     uint64 `gorm:"primaryKey"`
	SupplierID  uint64 `gorm:"primaryKey"`
	ProductID   uint64 `gorm:"primaryKey"`
	TeamID      uint64 `gorm:"primaryKey"`
	WarehouseID uint64 `gorm:"primaryKey"`
	Units       int64
	Value       float64
}

func (SupplierSaleOrderPart) TableName() string {
	return "supplier_sale_order_parts"
}

// SupplierSaleDailyReport is a row of `supplier_sale_daily_reports` — one Jakarta day, supplier, product, owning team
// and warehouse the units were taken from (00006), SIGNED: a cancel subtracts on its own day, from the warehouse the
// placement added to. Written only by the sales fold's upsert and the day re-fold.
type SupplierSaleDailyReport struct {
	ID          uint64 `gorm:"primaryKey"`
	Day         time.Time
	SupplierID  uint64
	ProductID   uint64
	TeamID      uint64
	WarehouseID uint64
	SalesCount  int64
	SalesValue  float64
	LastUpdated time.Time
}

func (SupplierSaleDailyReport) TableName() string {
	return "supplier_sale_daily_reports"
}

// SupplierFigureSums is a summed read of `metrics/suppliers`: the six restock figures and Penjualan beside them. Not a
// row of either table — the reads sum both, keyed alike.
type SupplierFigureSums struct {
	SupplierMetricColumns `gorm:"embedded"`

	SalesCount int64
	SalesValue float64
}
