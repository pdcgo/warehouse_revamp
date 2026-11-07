package liability_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

// errNothingToPay refuses a payment from a team that owes the other nothing — the creditor, or a square pair.
var errNothingToPay = errors.New("your team owes this team nothing right now, so there is no payment to record — only the team that owes records a payment")

// LiabilityPaymentRecord is PHASE ONE (#188): the payer says they paid.
//
// ⚠ IT POSTS NOTHING. No entry, no balance move — one side asserting a transfer is not evidence that
// it landed, and a ledger that moved on a claim would let any team write off its own debt by typing a
// number. The money moves in the books when the CREDITOR confirms and sees it arrive.
//
// The scope is the PAYER: you may only ever record your own payment, because recording somebody
// else's would be asserting a movement of their money.
//
// ⚠ AND THE PAYER MUST BE THE DEBTOR (the-debtor-claims-the-creditor-decides): the team whose side of the pair is
// negative. A creditor, or a team on a square pair, owes nothing, so its claim is refused as FailedPrecondition —
// the same refusal LiabilityPaymentRequestSend gives a pair that owes nothing. The pair's balance row is read FOR
// SHARE inside the payment's transaction, so a confirm squaring the pair at the same moment is waited for and its
// result read, never the figure from before it.
func (s *Service) LiabilityPaymentRecord(
	ctx context.Context,
	req *connect.Request[liabilityv1.LiabilityPaymentRecordRequest],
) (*connect.Response[liabilityv1.LiabilityPaymentRecordResponse], error) {
	payerTeamID := req.Msg.GetTeamId()
	creditorTeamID := req.Msg.GetCreditorTeamId()

	// The DB has the same CHECK, but a constraint violation reaches the caller as an internal error.
	// Paying yourself is a mistake worth naming.
	if payerTeamID == creditorTeamID {
		return nil, connect.NewError(connect.CodeInvalidArgument, errSameTeam)
	}

	// *Paid from* must be the PAYER's own live account (a-team-payment-posts-on-accept) — asked now, though
	// nothing posts until the creditor accepts, so a claim is never accepted against an account the payer
	// could not have paid from.
	err := s.checkAccount(ctx, payerTeamID, req.Msg.GetFromAccountId())
	if err != nil {
		return nil, err
	}

	// THE FREEZE POINT of a payment's figure, exact as claimed (the-backend-never-rounds-money), so the confirm posts
	// exactly what was claimed — Rp 316,675 posts Rp 316,675. It must be finite and above 0 (the wire's gt/finite,
	// re-checked for a direct caller); float dust below 4 places is a payment of nothing.
	amount := req.Msg.GetAmount()
	if !san_money.Positive(amount) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("a payment must be more than Rp 0"))
	}

	payment := liability_service_models.LiabilityPayment{
		PayerTeamID:    payerTeamID,
		CreditorTeamID: creditorTeamID,
		Amount:         amount,
		Status:         paymentRecorded,
		Note:           req.Msg.GetNote(),
		FromAccountID:  req.Msg.GetFromAccountId(),
		// PROOF, written in the same INSERT as the payment — GORM creates the association with the
		// parent, so a payment can never exist for a moment with its proof missing.
		//
		// ⚠ TAKEN ON TRUST, and it has to be. This service cannot check that these ids exist, or that
		// the creditor may read them, without reaching into document_service — which would need the
		// internal, scope-skipping path that a-payment-must-carry-proof exists to avoid. The failure
		// mode is benign and self-correcting: a creditor who cannot open the proof REJECTS the payment,
		// which is a state the flow already has.
		Documents: proofDocuments(req.Msg.GetDocumentIds()),
		// WHO claimed it, not just which team. This is the record that says a person moved money.
		RecordedBy:         actorUserID(ctx),
		RecordedIsOverride: isOverride(ctx),
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := payerOwes(tx, payerTeamID, creditorTeamID)
		if err != nil {
			return err
		}

		err = tx.Create(&payment).Error
		if err != nil {
			return err
		}

		// The debtor has paid — an asking creditor's request is answered, and leaves the balance (a-creditor-may-request-payment).
		return tx.
			Where("creditor_team_id = ? AND debtor_team_id = ?", creditorTeamID, payerTeamID).
			Delete(&liability_service_models.LiabilityPaymentRequest{}).
			Error
	})
	if errors.Is(err, errNothingToPay) {
		return nil, connect.NewError(connect.CodeFailedPrecondition, err)
	}

	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&liabilityv1.LiabilityPaymentRecordResponse{
		Payment: paymentToProto(&payment),
	}), nil
}

// payerOwes refuses with errNothingToPay unless the payer's side of the pair is negative — it owes the creditor more
// than float dust (san_money.Positive, the server's 4-place tolerance). No balance row is a pair nothing ever moved
// on: square.
//
// ⚠ FOR SHARE, not FOR UPDATE: nothing here writes the balance, and two claims by the same debtor must not queue
// behind each other — only behind a confirm (PostEntry's upsert), whose commit decides what is owed.
func payerOwes(tx *gorm.DB, payerTeamID, creditorTeamID uint64) error {
	var balance liability_service_models.LiabilityBalance

	err := tx.
		Clauses(clause.Locking{Strength: "SHARE"}).
		Where("team_id = ? AND counterparty_id = ?", payerTeamID, creditorTeamID).
		Take(&balance).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errNothingToPay
	}

	if err != nil {
		return err
	}

	// Negative = this team owes the counterparty (the ledger's sign, from the payer's side).
	if !san_money.Positive(-balance.Balance) {
		return errNothingToPay
	}

	return nil
}

// actorUserID reads who is making the call, 0 when the request carries no identity (a direct domain
// call in a test). 0 is stored rather than refused: a payment with an unknown recorder is still a
// payment, and losing it to preserve an audit column would be the wrong trade.
func actorUserID(ctx context.Context) uint64 {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return 0
	}

	return identity.GetIdentityId()
}

// proofDocuments turns the request's ids into the rows written beside the payment.
//
// ⚠ DUPLICATES ARE NOT FILTERED HERE. The unique index on (payment_id, document_id) is what makes
// attaching the same file twice the same fact rather than two of them — a check in Go would be a
// second copy of a rule the database already enforces, and the one that drifts.
func proofDocuments(ids []string) []liability_service_models.LiabilityPaymentDocument {
	if len(ids) == 0 {
		return nil
	}

	out := make([]liability_service_models.LiabilityPaymentDocument, 0, len(ids))
	for _, id := range ids {
		out = append(out, liability_service_models.LiabilityPaymentDocument{DocumentID: id})
	}

	return out
}
