package settlement_service_models

// SettlementMetricColumns is analytic_context.md §Field that tracked, as columns — embedded by both daily
// report tables so the list exists once in Go, as it does once in the doc.
//
// ⚠ THE LOG's SIGN CONVENTION: positive is money toward us, so InitialTotal is NEGATIVE.
type SettlementMetricColumns struct {
	InitialTotal          int64
	InitialTotalCancel    int64
	Other                 int64
	Fund                  int64
	ExternalAdsFee        int64
	AffiliateFee          int64
	MarketplaceAdjustment int64
	SystemAdjustment      int64

	// The day's net movement — the sum of the eight above.
	Change int64

	// The position at the day's start and end — stored, carried by the fold's increment.
	OpenBalance  int64
	CloseBalance int64
}
