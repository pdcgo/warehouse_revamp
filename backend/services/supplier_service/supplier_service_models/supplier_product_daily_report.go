package supplier_service_models

import "time"

// SupplierProductDailyReport is a row of `supplier_product_daily_reports` (00002) — one day, supplier, product and
// restocking team's figures (a-supplier-is-measured-per-product-per-day). Written only by the fold's upsert.
//
// ProductID and TeamID are the RESTOCKING team's — opaque cross-service ids, no FK. SupplierID has no FK either: the
// figures are kept for a deleted supplier (a-deleted-supplier-is-kept-for-its-figures).
type SupplierProductDailyReport struct {
	ID         uint64 `gorm:"primaryKey"`
	Day        time.Time
	SupplierID uint64
	ProductID  uint64
	TeamID     uint64

	SupplierMetricColumns `gorm:"embedded"`

	LastUpdated time.Time
}

func (SupplierProductDailyReport) TableName() string {
	return "supplier_product_daily_reports"
}

// SupplierMetricColumns are the six figures (each-figure-is-read-at-the-accept), shared by the row and by every
// summed read so a scan and a column cannot drift apart.
//
// ⚠ EXPORTED on purpose: GORM does not scan into an embedded struct whose type is unexported, and leaves every figure
// at zero without an error.
type SupplierMetricColumns struct {
	RestockCount            int64
	RestockValuation        int64
	ShippingLostCount       int64
	ShippingLostValuation   int64
	ShippingBrokenCount     int64
	ShippingBrokenValuation int64
}
