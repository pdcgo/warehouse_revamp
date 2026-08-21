package inventory_service_models

import "time"

// RestockCostLine is a row of `restock_cost_lines` (00021) — ONE THING THE ACCEPTING WAREHOUSE PAID
// to receive a delivery.
//
// It replaced `restock_requests.cod_shipping_fee`. The fee at the door was only ever one of the costs
// of getting goods in, and a column named after it could hold nothing else: anything else was either
// unrecorded or typed into the COD box and mislabelled.
//
// ⚠ ONE LINE, TWO CONSEQUENCES, and both are why it is written at acceptance:
//   - COSTING — it joins the request's ShippingCost in the freight spread over the units that arrived
//     sellable, so it reaches the batch's frozen unit cost and then an order's COGS.
//   - SETTLEMENT — it raises what the requesting team owes this warehouse, because the warehouse is
//     out of pocket for goods it does not own.
//
// IMMUTABLE once the delivery is accepted: the debt is frozen with it, so editing a line afterwards
// would silently rewrite what another team owes.
type RestockCostLine struct {
	ID               uint64 `gorm:"primaryKey"`
	RestockRequestID uint64

	// Which kind, as text — mapped in the handler layer, no DB CHECK IN-list (cf. #80).
	Kind string

	// Whole rupiah, always positive. A line of zero is a claim that nothing happened.
	Amount int64

	// Why, in words. Required for KindOther by the handler: an untyped amount with no words beside it
	// is a number the team being charged cannot argue with.
	Note string

	// Who typed it — an opaque user_service id, set from the caller's identity, never from the body.
	ActorID uint64

	CreatedAt time.Time
}

func (RestockCostLine) TableName() string {
	return "restock_cost_lines"
}
