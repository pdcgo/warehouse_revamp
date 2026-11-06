package settlement_service_models

// SettlementMetricColumns is analytic_context.md §Field that tracked, as columns — embedded by both daily
// report tables so the list exists once in Go, as it does once in the doc.
//
// ⚠ THE LOG's SIGN CONVENTION: positive is money toward us, so InitialTotal is NEGATIVE.
//
// Doubles since 00010 — sums of exact posted rows (the-backend-never-rounds-money), equal to the log within the
// tolerance; compare two of them with san_money.Equal (sameColumns), never ==.
type SettlementMetricColumns struct {
	InitialTotal          float64
	InitialTotalCancel    float64
	Other                 float64
	Fund                  float64
	ExternalAdsFee        float64
	AffiliateFee          float64
	MarketplaceAdjustment float64
	SystemAdjustment      float64

	// The five of 2026-09-24 (00006). Withdrawal counts in the position like every column
	// (#withdrawal-counts-in-the-position).
	Withdrawal            float64
	ShipmentAdjustment    float64
	LogisticReimbursement float64
	PlatformReimbursement float64
	MarketplaceProgram    float64

	// The day's net movement — the sum of every column above.
	Change float64

	// The position at the day's start and end — stored, carried by the fold's increment.
	OpenBalance  float64
	CloseBalance float64
}
