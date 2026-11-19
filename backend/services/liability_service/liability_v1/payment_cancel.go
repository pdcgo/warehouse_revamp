package liability_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

var errPaymentNotCancellable = errors.New("only a pending payment can be cancelled — once the team you paid " +
	"accepts or rejects it, or it is cancelled already, it stays as it is")

var errPayerNotSelling = errors.New("only a selling team cancels its own pending payment — a warehouse's payment " +
	"waits for the team it paid to accept or reject it")

// LiabilityPaymentCancel is the PAYER taking its own claim back while it is still pending
// (a-pending-payment-is-cancelled-by-its-selling-team): a selling team recorded a wrong amount and withdraws it before
// the creditor decides. It is a new arm BEFORE the accept, so an-accepted-payment-is-final is untouched — only a
// RECORDED payment moves, and nothing moves a CONFIRMED one.
//
// ⚠ IT POSTS NOTHING, exactly as reject: a pending claim never reached the ledger (the-debtor-claims-the-creditor-decides
// — *"a claim is not money"*), so there is nothing to undo — no PostEntry, no event for the accounts, whose
// `team_payment` rows post only on an accept. The proof stays attached and its shares stay granted: a share is
// permanent (a-payment-must-carry-proof), and the row stays in both teams' history marked cancelled.
//
// THE SCOPE IS THE PAYER, as in record: only the team that made the claim may take it back. `lockPayersPayment` carries
// that in its WHERE, so the creditor's or any other team's attempt reads as NOT FOUND — ids cannot be probed to learn
// who owes whom.
//
// ⚠ ONLY A SELLING PAYER. The policy names the selling owner and admin, so a warehouse's own people never reach here;
// Root and the Administrator pass every policy, so the payer's team type is asked of team_service as well — a
// warehouse's pending payment waits for its creditor whoever is acting.
//
// ⚠ THE ROW IS LOCKED FOR UPDATE, as in confirm and reject. A payer cancelling while the creditor accepts is the race
// this lock settles: without it both would read RECORDED, the accept would post the money and the cancel would mark the
// claim withdrawn — a settled debt whose claim says it was taken back. The second caller loses with FailedPrecondition.
func (s *Service) LiabilityPaymentCancel(
	ctx context.Context,
	req *connect.Request[liabilityv1.LiabilityPaymentCancelRequest],
) (*connect.Response[liabilityv1.LiabilityPaymentCancelResponse], error) {
	payerTeamID := req.Msg.GetTeamId()

	// Asked BEFORE the transaction: a question to another service inside one would hold the payment's row lock for it.
	err := s.payerSells(ctx, payerTeamID)
	if err != nil {
		return nil, err
	}

	var payment liability_service_models.LiabilityPayment

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		found, loadErr := lockPayersPayment(tx, payerTeamID, req.Msg.GetPaymentId())
		if loadErr != nil {
			return loadErr
		}

		// Only a RECORDED payment can be cancelled. A CONFIRMED one is final (an-accepted-payment-is-final), a
		// REJECTED one was already refused, and a CANCELLED one was already taken back — each is terminal.
		if found.Status != paymentRecorded {
			return errPaymentNotCancellable
		}

		now := time.Now()

		found.Status = paymentCancelled
		found.UpdatedAt = now

		// ⚠ `confirmed_by` AND `confirmed_at` STAY EMPTY, as on a rejection: nobody agreed to anything.
		updateErr := tx.Model(&liability_service_models.LiabilityPayment{}).
			Where("id = ?", found.ID).
			Updates(map[string]any{
				"status":     found.Status,
				"updated_at": now,
			}).
			Error
		if updateErr != nil {
			return updateErr
		}

		payment = *found

		return nil
	})
	if err != nil {
		return nil, paymentError(err)
	}

	return connect.NewResponse(&liabilityv1.LiabilityPaymentCancelResponse{
		Payment: paymentToProto(&payment),
	}), nil
}

// payerSells refuses a payer that is not a SELLING team (a-pending-payment-is-cancelled-by-its-selling-team: *not a
// warehouse payer*). It FAILS CLOSED: a team team_service does not know is refused rather than trusted.
func (s *Service) payerSells(ctx context.Context, teamID uint64) error {
	facts, err := s.names.TeamFacts(ctx, []uint64{teamID})
	if err != nil {
		// team_service's own refusal reaches the caller with its own code.
		var connectErr *connect.Error
		if errors.As(err, &connectErr) {
			return connectErr
		}

		return connect.NewError(connect.CodeUnavailable, err)
	}

	fact, known := facts[teamID]
	if !known || fact.Type != teamv1.TeamType_TEAM_TYPE_SELLING {
		return connect.NewError(connect.CodePermissionDenied, errPayerNotSelling)
	}

	return nil
}

// lockPayersPayment loads one payment FOR UPDATE, scoped to its PAYER — lockPayment's mirror for the one act the payer
// takes on a claim. Another team's payment is errPaymentMissing, never a refusal that admits it exists.
func lockPayersPayment(
	tx *gorm.DB,
	payerTeamID, paymentID uint64,
) (*liability_service_models.LiabilityPayment, error) {
	var found liability_service_models.LiabilityPayment

	err := tx.
		Raw("SELECT * FROM liability_payments WHERE id = ? AND payer_team_id = ? FOR UPDATE",
			paymentID, payerTeamID).
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
