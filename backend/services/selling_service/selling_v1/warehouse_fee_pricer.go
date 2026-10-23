package selling_v1

import "context"

// WarehouseFeePricer asks warehouse_service what a warehouse charges to fulfil one order
// (warehouse-prices-balance-records: warehouse_service owns the rate and calculates it, order_service calls).
//
// An INTERFACE THIS SERVICE OWNS, in this service's own terms, for exactly the reason CreditChecker is: selling_service
// never imports warehouse_service, and the implementation lives in the composition root, where knowing both is the job.
//
// ⚠ A WAREHOUSE THAT NEVER SET ITS FEE IS A REFUSAL, NOT A NUMBER (a-warehouse-with-no-rate-takes-no-orders). Price
// returns it as a *connect.Error with CodeFailedPrecondition whose message names the warehouse — "Gudang A has not set
// its fee" — and placeOrder hands that to the order form unchanged, because the person reading it is customer service,
// who needs to know which warehouse to ask.
type WarehouseFeePricer interface {
	// Price is the fee `warehouseID` charges for an order whose goods cost `goodsCost`, asked in `teamID`'s scope —
	// the ordering team, which never changes the rate (one-rate-per-warehouse).
	Price(ctx context.Context, teamID, warehouseID uint64, goodsCost float64) (float64, error)
}
