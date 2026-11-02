package liability_service_models

import "time"

// LiabilityPaymentRequest is a row of `liability_payment_requests` (00012) — a creditor's notice that it is owed
// (a-creditor-may-request-payment). It moves nothing: no entry, no block, no due date. One per (creditor, debtor) pair.
type LiabilityPaymentRequest struct {
	ID                uint64 `gorm:"primaryKey"`
	CreditorTeamID    uint64
	DebtorTeamID      uint64
	Amount            int64
	RequestedByUserID uint64
	CreatedAt         time.Time

	// The sender was Root or the Administrator outside the creditor team (an-override-is-stamped-in-every-service).
	// Follows the sender: a re-send replaces both.
	IsOverride bool
}

func (LiabilityPaymentRequest) TableName() string {
	return "liability_payment_requests"
}
