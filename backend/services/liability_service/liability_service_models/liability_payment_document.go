package liability_service_models

import "time"

// LiabilityPaymentDocument is a row of `liability_payment_documents` — one file the payer attached as
// proof that the money left a bank (a-payment-must-carry-proof).
//
// ⚠ IT IS WHAT THE CREDITOR ACTUALLY CHECKS. `balance_context.md` §Payment Flow makes confirmation a
// MANUAL act — a person comparing a transfer slip to their bank — and without this the payment
// carried 500 characters of free text and nothing to look at, so the creditor was accepting on the
// payer's word.
//
// ⚠ `DocumentID` HAS NO FOREIGN KEY and cannot have one: documents belong to document_service
// (HARD RULE 3), the same way `LiabilityLog.SourceID` names an order this service cannot reference.
//
// ⚠ WHETHER THE CREDITOR MAY READ IT IS NOT RECORDED HERE. That is document_service's
// `document_shares` row, granted by the payer as themselves before the payment is written. This
// service stores what the payment CLAIMS; it never decides who may see it — deciding that here would
// need an internal, scope-skipping read into another service, which is exactly what the share model
// exists to avoid.
//
// Schema owned by goose; GORM only reads and writes rows.
type LiabilityPaymentDocument struct {
	ID uint64 `gorm:"primaryKey"`

	PaymentID  uint64
	DocumentID string

	CreatedAt time.Time
}

func (LiabilityPaymentDocument) TableName() string {
	return "liability_payment_documents"
}
