package settlement_v1

import settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"

// SourceType is what caused an entry, in this package's own terms.
//
// A local type rather than the generated enum, because PostEntry is called from IN-PROCESS code —
// the restock acceptance (#184) and the order-event consumer (#186) — and a caller reaching for a
// proto enum to write a ledger row would be importing the wire format into a domain call.
type SourceType int

const (
	SourceTypeUnspecified SourceType = iota
	// The warehouse paid the courier at the door for goods it does not own (#155/#184). SourceID is
	// the restock request.
	SourceTypeCODFee
	// The warehouse fulfilled an order (#186). SourceID is the order.
	SourceTypeHandlingFee
	// The order sold another team's product (#186). SourceID is the order — one per owning team.
	SourceTypeProductFee
	// A confirmed payment (#188). SourceID is the payment.
	SourceTypePayment
)

// The text stored in `settlement_entries.source_type`. No DB CHECK guards these (the mapper and the
// proto do), exactly as `orders.status` is handled — an IN-list is one more place to drift when the
// enum grows.
const (
	sourceCODFee      = "cod_fee"
	sourceHandlingFee = "handling_fee"
	sourceProductFee  = "product_fee"
	sourcePayment     = "payment"
)

// sourceTypeText maps to storage. An UNSPECIFIED source returns "" and PostEntry refuses it: an entry
// that cannot say what caused it is unanswerable to the first question anybody asks a balance.
func sourceTypeText(t SourceType) string {
	switch t {
	case SourceTypeCODFee:
		return sourceCODFee
	case SourceTypeHandlingFee:
		return sourceHandlingFee
	case SourceTypeProductFee:
		return sourceProductFee
	case SourceTypePayment:
		return sourcePayment
	default:
		return ""
	}
}

// sourceTypeProto maps storage to the wire enum for the screens (#185). An unrecognised value reads
// as UNSPECIFIED rather than failing the row: a history that refuses to render because one entry
// carries a source this build does not know is worse than one line reading "unknown".
func sourceTypeProto(text string) settlementv1.SettlementSourceType {
	switch text {
	case sourceCODFee:
		return settlementv1.SettlementSourceType_SETTLEMENT_SOURCE_TYPE_COD_FEE
	case sourceHandlingFee:
		return settlementv1.SettlementSourceType_SETTLEMENT_SOURCE_TYPE_HANDLING_FEE
	case sourceProductFee:
		return settlementv1.SettlementSourceType_SETTLEMENT_SOURCE_TYPE_PRODUCT_FEE
	case sourcePayment:
		return settlementv1.SettlementSourceType_SETTLEMENT_SOURCE_TYPE_PAYMENT
	default:
		return settlementv1.SettlementSourceType_SETTLEMENT_SOURCE_TYPE_UNSPECIFIED
	}
}
