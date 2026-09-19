package liability_v1

import (
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

// SourceType is what caused an entry, in this package's own terms.
//
// A local type rather than the generated enum, because PostEntry is called from IN-PROCESS code —
// the restock acceptance (#184) and the order-event consumer (#186) — and a caller reaching for a
// proto enum to write a ledger row would be importing the wire format into a domain call.
type SourceType int

const (
	SourceTypeUnspecified SourceType = iota
	// The warehouse fulfilled an order, so the selling team owes it a fee (#186). SourceID is the
	// order. The business word says WHEN it is charged, where `handling_fee` said only that some
	// handling happened.
	SourceTypeOrderFee
	// The order sold another team's product (#186). SourceID is the order — one per owning team.
	SourceTypeProductFee
	// A confirmed payment (#188). SourceID is the payment.
	SourceTypePayment
	// Everything the warehouse laid out to receive one delivery — the courier's unplanned ask at the
	// door and anything else it paid to get the goods in. SourceID is the restock request, and the
	// amount is the sum of that request's cost lines.
	//
	// It was `restock_outlay`, and before that `cod_fee`. The money is INCIDENTAL by nature, which is
	// why no closed list of kinds can enumerate it.
	SourceTypeIncidentalFee
	// Stock the warehouse BROKE while holding it (#211). SourceID is the ADJUST MOVEMENT. The
	// warehouse owes the OWNING team: it holds the goods, the selling team owns them.
	SourceTypeBrokenGood
	// Stock the warehouse LOST while holding it — shrinkage, not breakage. Same direction and
	// valuation, a different thing to answer for.
	SourceTypeLostGood
	// Goods reimbursed and then FOUND AGAIN. Posted as a REVERSAL against the find's own movement.
	SourceTypeFound
)

// The text stored in `liability_logs.source_type`. No DB CHECK guards these (the mapper and the
// proto do), exactly as `orders.status` is handled — an IN-list is one more place to drift when the
// enum grows.
const (
	sourceOrderFee      = "order_fee"
	sourceProductFee    = "product_fee"
	sourcePayment       = "payment"
	sourceIncidentalFee = "incidental_fee"
	sourceBrokenGood    = "broken_good"
	sourceLostGood      = "lost_good"
	sourceFound         = "found"
)

// sourceTypeText maps to storage. An UNSPECIFIED source returns "" and PostEntry refuses it: an entry
// that cannot say what caused it is unanswerable to the first question anybody asks a balance.
func sourceTypeText(t SourceType) string {
	switch t {
	case SourceTypeOrderFee:
		return sourceOrderFee
	case SourceTypeProductFee:
		return sourceProductFee
	case SourceTypePayment:
		return sourcePayment
	case SourceTypeIncidentalFee:
		return sourceIncidentalFee
	case SourceTypeBrokenGood:
		return sourceBrokenGood
	case SourceTypeLostGood:
		return sourceLostGood
	case SourceTypeFound:
		return sourceFound
	default:
		return ""
	}
}

// sourceTypeProto maps storage to the wire enum for the screens (#185). An unrecognised value reads
// as UNSPECIFIED rather than failing the row: a history that refuses to render because one entry
// carries a source this build does not know is worse than one line reading "unknown".
func sourceTypeProto(text string) liabilityv1.LiabilitySourceType {
	switch text {
	case sourceOrderFee:
		return liabilityv1.LiabilitySourceType_LIABILITY_SOURCE_TYPE_ORDER_FEE
	case sourceProductFee:
		return liabilityv1.LiabilitySourceType_LIABILITY_SOURCE_TYPE_PRODUCT_FEE
	case sourcePayment:
		return liabilityv1.LiabilitySourceType_LIABILITY_SOURCE_TYPE_PAYMENT
	case sourceIncidentalFee:
		return liabilityv1.LiabilitySourceType_LIABILITY_SOURCE_TYPE_INCIDENTAL_FEE
	case sourceBrokenGood:
		return liabilityv1.LiabilitySourceType_LIABILITY_SOURCE_TYPE_BROKEN_GOOD
	case sourceLostGood:
		return liabilityv1.LiabilitySourceType_LIABILITY_SOURCE_TYPE_LOST_GOOD
	case sourceFound:
		return liabilityv1.LiabilitySourceType_LIABILITY_SOURCE_TYPE_FOUND
	default:
		return liabilityv1.LiabilitySourceType_LIABILITY_SOURCE_TYPE_UNSPECIFIED
	}
}

// sourceTypeFromText is the inverse of sourceTypeText, for re-posting a movement the ledger already
// recorded — the reversal path reads a stored entry and posts its opposite (#186).
func sourceTypeFromText(text string) SourceType {
	switch text {
	case sourceOrderFee:
		return SourceTypeOrderFee
	case sourceProductFee:
		return SourceTypeProductFee
	case sourcePayment:
		return SourceTypePayment
	case sourceIncidentalFee:
		return SourceTypeIncidentalFee
	case sourceBrokenGood:
		return SourceTypeBrokenGood
	case sourceLostGood:
		return SourceTypeLostGood
	case sourceFound:
		return SourceTypeFound
	default:
		return SourceTypeUnspecified
	}
}

// The text stored in `liability_payments.status` (#188). Same reasoning as the source types above —
// no DB CHECK guards these, because an IN-list is one more place to drift when the enum grows.
const (
	paymentRecorded  = "recorded"
	paymentConfirmed = "confirmed"
	paymentRejected  = "rejected"
	paymentReversed  = "reversed"
)

// paymentStatusProto maps storage to the wire enum. An unrecognised value reads as UNSPECIFIED rather
// than failing the row: a list that refuses to render because one payment carries a status this build
// does not know is worse than one line reading "unknown".
func paymentStatusProto(text string) liabilityv1.LiabilityPaymentStatus {
	switch text {
	case paymentRecorded:
		return liabilityv1.LiabilityPaymentStatus_LIABILITY_PAYMENT_STATUS_RECORDED
	case paymentConfirmed:
		return liabilityv1.LiabilityPaymentStatus_LIABILITY_PAYMENT_STATUS_CONFIRMED
	case paymentRejected:
		return liabilityv1.LiabilityPaymentStatus_LIABILITY_PAYMENT_STATUS_REJECTED
	case paymentReversed:
		return liabilityv1.LiabilityPaymentStatus_LIABILITY_PAYMENT_STATUS_REVERSED
	default:
		return liabilityv1.LiabilityPaymentStatus_LIABILITY_PAYMENT_STATUS_UNSPECIFIED
	}
}

// documentIDs flattens the proof association to the ids the wire carries.
//
// ⚠ NIL RATHER THAN AN EMPTY SLICE when there are none, which protobuf renders as an absent field.
// "No proof" and "the caller did not load it" look identical here on purpose: the distinction that
// matters to a reader is whether the payment HAS proof, and a payment recorded since
// a-payment-must-carry-proof always does.
func documentIDs(docs []liability_service_models.LiabilityPaymentDocument) []string {
	if len(docs) == 0 {
		return nil
	}

	out := make([]string, 0, len(docs))
	for i := range docs {
		out = append(out, docs[i].DocumentID)
	}

	return out
}

// paymentToProto carries the nil ConfirmedAt through as 0 — "not confirmed yet" rather than a date at
// the epoch. The status already says which, so a caller never has to read 0 as a timestamp.
func paymentToProto(p *liability_service_models.LiabilityPayment) *liabilityv1.LiabilityPayment {
	var confirmedAt int64
	if p.ConfirmedAt != nil {
		confirmedAt = p.ConfirmedAt.Unix()
	}

	return &liabilityv1.LiabilityPayment{
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
		DocumentIds:     documentIDs(p.Documents),
		Reason:          p.Reason,
	}
}
