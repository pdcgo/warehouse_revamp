package selling_service_models

import "time"

// OrderDailyReport is a row of `order_daily_reports` (00030) — one day, one order metric, one seller, shop, warehouse
// and creator, and what moved there (docs/business/order/order_statistic_metric.md).
//
// ⚠ DERIVED. Built by selling_service's own fold from OrderPlaced, OrderCancelled and OrderStatusChanged
// (a-report-is-fed-by-events-only-for-now); the orders and their timeline are the truth.
type OrderDailyReport struct {
	ID uint64 `gorm:"primaryKey"`

	// The move's Jakarta day (a-fact-counts-on-the-day-it-happened).
	Day time.Time
	// created · cancelled · return_created · return_arrived · lost_created · warehouse_fee (00038). A warehouse_fee
	// row is SIGNED — a placement adds +1 and its fee, a cancel −1 and the fee, each on its own day
	// (a-warehouse-fee-counts-on-its-day-and-a-cancel-takes-it-back-on-its-day): OrderCount is the fee transactions,
	// Total the fee amount, MpTotal 0.
	Metric string

	TeamID      uint64
	ShopID      uint64
	WarehouseID uint64
	// The order's creator (a-metrics-user-is-the-orders-creator). 0 = none recorded.
	UserID uint64

	OrderMetricColumns

	LastUpdated time.Time
}

func (OrderDailyReport) TableName() string {
	return "order_daily_reports"
}

// OrderMetricColumns is what a report row counts, and what a grouped read sums: orders, Σ `total_cost`, Σ
// `platform_total` (a-total-is-the-total-cost).
type OrderMetricColumns struct {
	OrderCount int64
	Total      float64
	MpTotal    float64
}
