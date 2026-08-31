package liability_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

var (
	errPaymentMissing    = errors.New("payment not found")
	errPaymentNotWaiting = errors.New("only a recorded payment can be confirmed")
)

// LiabilityPaymentConfirm is PHASE TWO (#188): the creditor saw the money arrive. THIS is what posts.
//
// ⚠ THE SCOPE IS THE CREDITOR, and the whole two-phase design rests on it. `team_id` must be the team
// that was PAID — a payer able to confirm their own payment could write off any debt they liked by
// typing a number and agreeing with themselves. The lookup carries `creditor_team_id = team_id` in
// its WHERE rather than checking after loading, so somebody else's payment is NOT FOUND rather than
// forbidden: a caller must not be able to probe for payment ids they have no business knowing about.
//
// THE STATUS CHANGE AND THE POSTING ARE ONE TRANSACTION. A payment marked confirmed whose entry never
// landed is a debt the books still show and the screen says is settled — the exact disagreement this
// service exists to prevent.
//
// ⚠ THE ROW IS LOCKED FOR UPDATE. Two managers clicking Confirm on the same payment in the same
// second is an ordinary event here, and without the lock both would read RECORDED, both would pass
// the check, and the debt would be paid off twice. The ledger's own unique index would catch the
// second posting — but as `ErrAlreadyPosted` from inside a transaction, which is a worse way to
// learn it.
func (s *Service) LiabilityPaymentConfirm(
	ctx context.Context,
	req *connect.Request[liabilityv1.LiabilityPaymentConfirmRequest],
) (*connect.Response[liabilityv1.LiabilityPaymentConfirmResponse], error) {
	var payment liability_service_models.LiabilityPayment

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		found, loadErr := lockPayment(tx, req.Msg.GetTeamId(), req.Msg.GetPaymentId())
		if loadErr != nil {
			return loadErr
		}

		// Only a RECORDED payment can be confirmed. Confirming an already-confirmed one would post a
		// second entry and settle the debt twice; confirming a reversed one would silently undo a
		// correction somebody made deliberately.
		if found.Status != paymentRecorded {
			return errPaymentNotWaiting
		}

		now := time.Now()

		found.Status = paymentConfirmed
		found.ConfirmedBy = actorUserID(ctx)
		found.ConfirmedAt = &now

		updateErr := tx.Model(&liability_service_models.LiabilityPayment{}).
			Where("id = ?", found.ID).
			Updates(map[string]any{
				"status":       found.Status,
				"confirmed_by": found.ConfirmedBy,
				"confirmed_at": now,
				"updated_at":   now,
			}).Error
		if updateErr != nil {
			return updateErr
		}

		_, postErr := s.PostEntry(ctx, tx, paymentPosting(found, false, found.ConfirmedBy))
		if postErr != nil {
			return postErr
		}

		payment = *found

		return nil
	})
	if err != nil {
		return nil, paymentError(err)
	}

	return connect.NewResponse(&liabilityv1.LiabilityPaymentConfirmResponse{
		Payment: paymentToProto(&payment),
	}), nil
}

// paymentPosting turns a payment into the ledger movement it causes.
//
// ⚠ A PAYMENT MOVES VALUE THE OPPOSITE WAY TO A FEE, so the PAYER is the CREDITOR of this movement:
// paying reduces the payer's payable, which means their balance moves UP toward zero while the team
// that was paid moves DOWN. Writing the teams the "natural" way round would settle the debt
// backwards — arithmetically consistent, completely wrong, and invisible until somebody reads a
// screen.
//
// `reversal` distinguishes the confirmation from its undoing in the ledger's idempotency key
// (source_type, source_id, counterparty, reversal), which is what lets one payment be posted once and
// un-posted once, and neither of them twice.
// ⚠ `actorID` IS THE PERSON WHO DECIDED, NEVER THE ONE WHO CLAIMED. A recorded payment moves no
// money, so the movement belongs to the creditor who confirmed it — and a reversal belongs to
// whoever undid that, which is a third act by possibly a third person
// (every-entry-names-who-posted-it). Passing the payer here would credit the debtor with a
// settlement they did not make happen.
func paymentPosting(
	p *liability_service_models.LiabilityPayment,
	reversal bool,
	actorID uint64,
) Posting {
	return Posting{
		DebtorTeamID:   p.CreditorTeamID,
		CreditorTeamID: p.PayerTeamID,
		Amount:         p.Amount,
		SourceType:     SourceTypePayment,
		SourceID:       p.ID,
		Reversal:       reversal,
		ActorID:        actorID,
	}
}

// lockPayment loads one payment FOR UPDATE, scoped to the creditor.
//
// The scope is in the WHERE, not in a check after loading: a payment belonging to another pair must
// read as NOT FOUND, so a caller cannot probe ids to learn who owes whom.
func lockPayment(
	tx *gorm.DB,
	creditorTeamID, paymentID uint64,
) (*liability_service_models.LiabilityPayment, error) {
	var found liability_service_models.LiabilityPayment

	err := tx.
		Raw("SELECT * FROM liability_payments WHERE id = ? AND creditor_team_id = ? FOR UPDATE",
			paymentID, creditorTeamID).
		Scan(&found).
		Error
	if err != nil {
		return nil, err
	}

	if found.ID == 0 {
		return nil, errPaymentMissing
	}

	return &found, nil
}

// paymentError maps the domain refusals to codes a screen can act on, and everything else to Internal.
func paymentError(err error) error {
	switch {
	case errors.Is(err, errPaymentMissing):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, errPaymentNotWaiting), errors.Is(err, errPaymentNotConfirmed):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.Is(err, ErrAlreadyPosted):
		// The status guard above should make this unreachable. If it fires anyway the debt is already
		// settled in the books, which is what the caller wanted — but it is NOT reported as success,
		// because a payment whose row and whose ledger disagree is worth someone looking at.
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		return dbError(err)
	}
}
