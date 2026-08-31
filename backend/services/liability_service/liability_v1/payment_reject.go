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

var errPaymentNotRejectable = errors.New("only a recorded payment can be rejected")

// LiabilityPaymentReject is the `no` arm of `balance_context.md` §Payment Flow: the creditor checked
// the proof manually and the money is not there.
//
// ⚠ IT POSTS NOTHING, and that is the whole reason the state exists. Before it, a creditor facing a
// claim that never landed had two bad options — leave it at RECORDED forever, or CONFIRM and then
// REVERSE, which writes two real ledger movements for money that never moved and leaves the pair's
// history telling a story that did not happen. Rejecting writes one status and one sentence.
//
// ⚠ IT IS NOT `REVERSE`. Rejecting refuses a CLAIM that was never posted; reversing undoes a
// CONFIRMATION that was. The owner's lifecycle diagram makes both terminal but only one of them ever
// touched the ledger, so they must not share a path — which is why this handler has no PostEntry call
// at all rather than a conditional one.
//
// THE SCOPE IS THE CREDITOR, exactly as in confirm: only the team that was supposedly paid can say
// the money did not arrive. `lockPayment` carries that in its WHERE, so another pair's payment reads
// as NOT FOUND rather than forbidden — a caller must not be able to probe ids to learn who owes whom.
//
// ⚠ THE ROW IS LOCKED FOR UPDATE even though nothing posts. Confirm and reject race each other by
// design — two managers, one payment, one second — and without the lock both would read RECORDED,
// one would post the money and the other would mark it refused, leaving a settled debt whose claim
// says it was rejected. The lock makes the second caller lose cleanly with a FailedPrecondition.
func (s *Service) LiabilityPaymentReject(
	ctx context.Context,
	req *connect.Request[liabilityv1.LiabilityPaymentRejectRequest],
) (*connect.Response[liabilityv1.LiabilityPaymentRejectResponse], error) {
	var payment liability_service_models.LiabilityPayment

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		found, loadErr := lockPayment(tx, req.Msg.GetTeamId(), req.Msg.GetPaymentId())
		if loadErr != nil {
			return loadErr
		}

		// Only a RECORDED payment can be rejected. Rejecting a CONFIRMED one would leave a posted
		// entry beside a claim that says the money never came — the disagreement between the books and
		// the screen that this service exists to prevent. That correction is `LiabilityPaymentReverse`,
		// which posts the compensating entry a rejection deliberately does not.
		if found.Status != paymentRecorded {
			return errPaymentNotRejectable
		}

		now := time.Now()

		found.Status = paymentRejected
		found.Reason = req.Msg.GetReason()

		// ⚠ `confirmed_by` AND `confirmed_at` STAY EMPTY. A rejection is not a confirmation, and
		// borrowing those columns to record who refused would make every "when was this agreed" query
		// count refusals as agreements. Who rejected is answerable from the log; that it was never
		// agreed is the fact these two columns must go on telling.
		updateErr := tx.Model(&liability_service_models.LiabilityPayment{}).
			Where("id = ?", found.ID).
			Updates(map[string]any{
				"status":     found.Status,
				"reason":     found.Reason,
				"updated_at": now,
			}).Error
		if updateErr != nil {
			return updateErr
		}

		payment = *found

		return nil
	})
	if err != nil {
		return nil, paymentError(err)
	}

	return connect.NewResponse(&liabilityv1.LiabilityPaymentRejectResponse{
		Payment: paymentToProto(&payment),
	}), nil
}
