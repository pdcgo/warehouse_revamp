package settlement_v1

import (
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

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
	// Everything the warehouse laid out to receive one delivery — the COD fee at the door and anything
	// else it paid to get the goods in. SourceID is the restock request, and the amount is the sum of
	// that request's cost lines. Supersedes SourceTypeCODFee, which nothing posts under any more.
	SourceTypeRestockOutlay
	// Stock the warehouse broke or lost while holding it (#211). SourceID is the ADJUST MOVEMENT.
	// The warehouse owes the OWNING team: it holds the goods, the selling team owns them.
	SourceTypeStockDamage
)

// The text stored in `settlement_entries.source_type`. No DB CHECK guards these (the mapper and the
// proto do), exactly as `orders.status` is handled — an IN-list is one more place to drift when the
// enum grows.
const (
	sourceCODFee        = "cod_fee"
	sourceHandlingFee   = "handling_fee"
	sourceProductFee    = "product_fee"
	sourcePayment       = "payment"
	sourceRestockOutlay = "restock_outlay"
	sourceStockDamage   = "stock_damage"
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
	case SourceTypeRestockOutlay:
		return sourceRestockOutlay
	case SourceTypeStockDamage:
		return sourceStockDamage
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
	case sourceRestockOutlay:
		return settlementv1.SettlementSourceType_SETTLEMENT_SOURCE_TYPE_RESTOCK_OUTLAY
	case sourceStockDamage:
		return settlementv1.SettlementSourceType_SETTLEMENT_SOURCE_TYPE_STOCK_DAMAGE
	default:
		return settlementv1.SettlementSourceType_SETTLEMENT_SOURCE_TYPE_UNSPECIFIED
	}
}

// sourceTypeFromText is the inverse of sourceTypeText, for re-posting a movement the ledger already
// recorded — the reversal path reads a stored entry and posts its opposite (#186).
func sourceTypeFromText(text string) SourceType {
	switch text {
	case sourceCODFee:
		return SourceTypeCODFee
	case sourceHandlingFee:
		return SourceTypeHandlingFee
	case sourceProductFee:
		return SourceTypeProductFee
	case sourcePayment:
		return SourceTypePayment
	case sourceRestockOutlay:
		return SourceTypeRestockOutlay
	case sourceStockDamage:
		return SourceTypeStockDamage
	default:
		return SourceTypeUnspecified
	}
}

// The text stored in `settlement_payments.status` (#188). Same reasoning as the source types above —
// no DB CHECK guards these, because an IN-list is one more place to drift when the enum grows.
const (
	paymentRecorded  = "recorded"
	paymentConfirmed = "confirmed"
	paymentReversed  = "reversed"
)

// paymentStatusProto maps storage to the wire enum. An unrecognised value reads as UNSPECIFIED rather
// than failing the row: a list that refuses to render because one payment carries a status this build
// does not know is worse than one line reading "unknown".
func paymentStatusProto(text string) settlementv1.SettlementPaymentStatus {
	switch text {
	case paymentRecorded:
		return settlementv1.SettlementPaymentStatus_SETTLEMENT_PAYMENT_STATUS_RECORDED
	case paymentConfirmed:
		return settlementv1.SettlementPaymentStatus_SETTLEMENT_PAYMENT_STATUS_CONFIRMED
	case paymentReversed:
		return settlementv1.SettlementPaymentStatus_SETTLEMENT_PAYMENT_STATUS_REVERSED
	default:
		return settlementv1.SettlementPaymentStatus_SETTLEMENT_PAYMENT_STATUS_UNSPECIFIED
	}
}

// paymentToProto carries the nil ConfirmedAt through as 0 — "not confirmed yet" rather than a date at
// the epoch. The status already says which, so a caller never has to read 0 as a timestamp.
func paymentToProto(p *settlement_service_models.SettlementPayment) *settlementv1.SettlementPayment {
	var confirmedAt int64
	if p.ConfirmedAt != nil {
		confirmedAt = p.ConfirmedAt.Unix()
	}

	return &settlementv1.SettlementPayment{
		Id:              p.ID,
		PayerTeamId:     p.PayerTeamID,
		CreditorTeamId:  p.CreditorTeamID,
		Amount:          p.Amount,
		Status:          paymentStatusProto(p.Status),
		Note:            p.Note,
		RecordedBy:      p.RecordedBy,
		ConfirmedBy:     p.ConfirmedBy,
		CreatedAtUnix:   p.CreatedAt.Unix(),
		ConfirmedAtUnix: confirmedAt,
	}
}
