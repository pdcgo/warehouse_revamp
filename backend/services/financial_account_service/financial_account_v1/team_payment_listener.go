package financial_account_v1

import (
	"context"
	"fmt"
	"slices"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// TeamPaymentHandler is the listener that posts a TEAM PAYMENT — liability's `LiabilityPaymentAccepted` — out of
// the payer's account and into the creditor's (a-team-payment-posts-on-accept): two `team_payment` rows sharing a
// group, on the day the creditor accepted. Nothing else from liability is heard — a recorded or rejected payment
// moves no account, and an accepted one is final (a-team-payment-is-never-reversed).
//
// It follows the handler contract (one-contract-for-both-handler-types): one event, its own transaction, the
// event id CLAIMED inside it beside the write — a redelivery posts nothing, and a failure rolls the claim back
// with the post, so the redelivery genuinely retries.
func (s *Service) TeamPaymentHandler() event_source.PushHandler {
	return func(ctx context.Context, event *eventsv1.Event) error {
		accepted := event.GetLiabilityPaymentAccepted()
		if accepted == nil {
			return nil
		}

		return s.postTeamPayment(ctx, event, accepted)
	}
}

func (s *Service) postTeamPayment(ctx context.Context, event *eventsv1.Event, accepted *eventsv1.LiabilityPaymentAccepted) error {
	// NOT acked: an acceptance with nowhere to land or nothing to move is money this build cannot file, and
	// dropping it would leave both accounts short with nothing disagreeing — the dead-letter queue is where a
	// person sees it. Liability's contract makes both impossible; this is the listener not trusting that.
	if accepted.GetToAccountId() == 0 || accepted.GetAmount() <= 0 {
		return fmt.Errorf("financial_account: %s: an accepted payment with no account to land in, or no amount", event.GetEventId())
	}

	// The day the creditor accepted — the envelope's clock, the one liability stamped (my spec, recorded in
	// a-team-payment-posts-on-accept).
	occurredAt := event.GetOccurredAt().AsTime()
	amount := float64(accepted.GetAmount())
	ref := fmt.Sprintf("Team payment #%d", accepted.GetPaymentId())

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		isNew, err := s.dedup.Claim(ctx, tx, event)
		if err != nil {
			return err
		}

		if !isNew {
			return nil
		}

		owners := map[uint64]uint64{accepted.GetToAccountId(): accepted.GetCreditorTeamId()}
		if accepted.GetFromAccountId() != 0 {
			owners[accepted.GetFromAccountId()] = accepted.GetPayerTeamId()
		}

		locked, err := lockOwnedAccounts(tx, owners)
		if err != nil {
			return fmt.Errorf("financial_account: %s: %w", event.GetEventId(), err)
		}

		group, err := nextGroup(tx)
		if err != nil {
			return err
		}

		to := locked[accepted.GetToAccountId()]

		// A payment recorded before *Paid from* existed names no account it left: only the creditor's leg posts,
		// and a reconcile on the payer's side finds the transfer as an `adjustment` (my spec).
		if from := locked[accepted.GetFromAccountId()]; from != nil {
			_, err = post(tx, from, entry{
				changeType:       m.ChangeTeamPayment,
				change:           -amount,
				description:      fmt.Sprintf("%s to team #%d", ref, accepted.GetCreditorTeamId()),
				occurredAt:       occurredAt,
				actorID:          accepted.GetActorId(),
				groupID:          group,
				counterAccountID: to.ID,
			})
			if err != nil {
				return err
			}
		}

		_, err = post(tx, to, entry{
			changeType:       m.ChangeTeamPayment,
			change:           amount,
			description:      fmt.Sprintf("%s from team #%d", ref, accepted.GetPayerTeamId()),
			occurredAt:       occurredAt,
			actorID:          accepted.GetActorId(),
			groupID:          group,
			counterAccountID: accepted.GetFromAccountId(),
		})

		return err
	})
}

// lockOwnedAccounts is lockAccounts for accounts of DIFFERENT teams — a team payment's two legs, one in the payer's
// books and one in the creditor's. It keeps the ledger's one lock rule: every account FOR UPDATE, in id order, in
// one statement, so a payment one way and a transfer or a payment the other way cannot deadlock.
//
// An account that is missing, or not the team the event says owns it, is an error and NOT acked: liability asked
// before recording and accepting, so a mismatch here is a bug worth a dead letter, never money to file somewhere.
// An ARCHIVED account still posts (my spec, as for a withdrawal): refusing would dead-letter money that moved.
func lockOwnedAccounts(tx *gorm.DB, owners map[uint64]uint64) (map[uint64]*m.FinancialAccount, error) {
	ids := make([]uint64, 0, len(owners))
	for id := range owners {
		ids = append(ids, id)
	}

	slices.Sort(ids)

	rows := []m.FinancialAccount{}

	err := tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id IN ?", ids).
		Order("id").
		Find(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	out := make(map[uint64]*m.FinancialAccount, len(rows))
	for i := range rows {
		if rows[i].TeamID != owners[rows[i].ID] {
			return nil, fmt.Errorf("account %d is team %d's, not team %d's", rows[i].ID, rows[i].TeamID, owners[rows[i].ID])
		}

		out[rows[i].ID] = &rows[i]
	}

	if len(out) != len(ids) {
		return nil, fmt.Errorf("accounts %v: %d of %d found", ids, len(out), len(ids))
	}

	return out, nil
}
