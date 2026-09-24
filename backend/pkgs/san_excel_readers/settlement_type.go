package san_excel_readers

import "errors"

// SettlementType is the classification a settlement row is imported as.
//
// The values are settlement_service's, read from
// docs/business/settlement/context.md#what-is-settlement_type. They are listed here so a reader
// cannot invent one; a value that section does not carry does not belong in this file.
type SettlementType string

const (
	// SettlementInitialTotal is the estimated marketplace total, written when an order is
	// created. No file produces it — order_service does.
	SettlementInitialTotal SettlementType = "initial_total"
	// SettlementInitialTotalCancel reverses it when the order is cancelled.
	SettlementInitialTotalCancel SettlementType = "initial_total_cancel"

	// SettlementFund is real revenue. Not net: the platform keeps charging afterwards.
	SettlementFund SettlementType = "fund"
	// SettlementWithdrawal is money leaving the marketplace wallet for a bank account.
	SettlementWithdrawal SettlementType = "withdrawal"

	SettlementExternalAdsFee SettlementType = "external_ads_fee"
	SettlementAffiliateFee   SettlementType = "affiliate_fee"

	// SettlementLogisticReimbursement is the platform paying back a shipping cost.
	//
	// ⚠ Owner-decided (2026-09-24) and NOT YET in
	// docs/business/settlement/context.md#what-is-settlement_type — the eleventh value, after
	// SettlementMarketplaceProgram. ⚠ Spelled "logistic", singular, where the TikTok column says
	// "Logistics reimbursement"; that is the owner's spelling, kept verbatim.
	SettlementLogisticReimbursement SettlementType = "logistic_reimbursement"
	// SettlementPlatformReimbursement is the platform paying back something that is not shipping
	// — the sampled rows are compensation against a specific order.
	//
	// ⚠ Owner-decided (2026-09-24), the TWELFTH value and also not yet in the owner's enum.
	SettlementPlatformReimbursement SettlementType = "platform_reimbursement"

	// SettlementMarketplaceAdjustment is a correction the PLATFORM made.
	SettlementMarketplaceAdjustment SettlementType = "marketplace_adjustment"
	// SettlementMarketplaceProgram is earnings that reach the wallet through a named platform
	// PROGRAMME rather than an ordinary sale — Shopee's FLEXI export scheme is the sampled case.
	//
	// ⚠ Owner-decided (2026-09-24) and NOT YET in
	// docs/business/settlement/context.md#what-is-settlement_type, which lists nine values and
	// not this one. The doc is the owner's to update; this constant is ahead of it.
	SettlementMarketplaceProgram SettlementType = "marketplace_program"
	// SettlementSystemAdjustment is a correction WE made, to repair our own report.
	SettlementSystemAdjustment SettlementType = "system_adjustment"

	SettlementOther SettlementType = "other"
)

// ErrNoSettlementTypeMapping is for when a row's platform transaction type has no row in the
// mapping table: a gap in the contract, not a broken file — the file is fine and the caller can
// still read every other field.
//
// ⚠ Nothing returns it yet. SettlementType panics rather than classifying, so this is the shape
// the gap will take once the mapping is written, kept here because there is already a known gap
// to return it for: "Program Ekspor Shopee FLEXI" is in the samples and not in the table.
var ErrNoSettlementTypeMapping = errors.New("san_excel_readers: no settlement type mapped for this transaction type")
