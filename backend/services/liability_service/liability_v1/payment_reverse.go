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

var errPaymentNotConfirmed = errors.New("only a confirmed payment can be reversed")

// LiabilityPaymentReverse undoes a confirmation made in error (#188).
//
// ⚠ IT IS A COMPENSATING ENTRY, NEVER AN UPDATE OR A DELETE. The original confirmation stays in the
// ledger and an equal-and-opposite entry joins it, so the balance nets back and the history shows the
// payment was agreed and then withdrawn. "It was briefly settled" is exactly what an audit needs to
// see, and a ledger you can edit is not evidence of anything.
//
// The scope is the CREDITOR again: whoever confirmed is who un-confirms. The payer cannot reverse an
// agreement it did not make.
//
// ONLY A CONFIRMED PAYMENT CAN BE REVERSED. Reversing a RECORDED one would post an undo for a
// movement that never happened; reversing a REVERSED one would post the undo twice.
//
// The reason is REQUIRED by the contract and stored. Reversing says a person got it wrong, and the
// next person to read the history deserves to know what happened rather than seeing two entries that
// cancel out for no stated reason.
func (s *Service) LiabilityPaymentReverse(
	ctx context.Context,
	req *connect.Request[liabilityv1.LiabilityPaymentReverseRequest],
) (*connect.Response[liabilityv1.LiabilityPaymentReverseResponse], error) {
	var payment liability_service_models.LiabilityPayment

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		found, loadErr := lockPayment(tx, req.Msg.GetTeamId(), req.Msg.GetPaymentId())
		if loadErr != nil {
			return loadErr
		}

		if found.Status != paymentConfirmed {
			return errPaymentNotConfirmed
		}

		now := time.Now()

		found.Status = paymentReversed
		found.Reason = req.Msg.GetReason()

		updateErr := tx.Model(&liability_service_models.LiabilityPayment{}).
			Where("id = ?", found.ID).
			Updates(map[string]any{
				"status": found.Status,
				// ⚠ `confirmed_at` and `confirmed_by` SURVIVE. When it was agreed, and by whom, are
				// facts; the reversal is a later one. Clearing them would erase who to ask about it.
				"reason":          found.Reason,
				"updated_at":      now,
			}).Error
		if updateErr != nil {
			return updateErr
		}

		_, postErr := s.PostEntry(ctx, tx, paymentPosting(found, true, actorUserID(ctx)))
		if postErr != nil {
			return postErr
		}

		payment = *found

		return nil
	})
	if err != nil {
		return nil, paymentError(err)
	}

	return connect.NewResponse(&liabilityv1.LiabilityPaymentReverseResponse{
		Payment: paymentToProto(&payment),
	}), nil
}
