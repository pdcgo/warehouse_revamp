package liability_v1

import (
	"context"

	"connectrpc.com/connect"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

// LiabilityPaymentRecord is PHASE ONE (#188): the payer says they paid.
//
// ⚠ IT POSTS NOTHING. No entry, no balance move — one side asserting a transfer is not evidence that
// it landed, and a ledger that moved on a claim would let any team write off its own debt by typing a
// number. The money moves in the books when the CREDITOR confirms and sees it arrive.
//
// The scope is the PAYER: you may only ever record your own payment, because recording somebody
// else's would be asserting a movement of their money.
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

	payment := liability_service_models.LiabilityPayment{
		PayerTeamID:    payerTeamID,
		CreditorTeamID: creditorTeamID,
		Amount:         req.Msg.GetAmount(),
		Status:         paymentRecorded,
		Note:           req.Msg.GetNote(),
		// WHO claimed it, not just which team. This is the record that says a person moved money.
		RecordedBy: actorUserID(ctx),
	}

	err := s.db.WithContext(ctx).Create(&payment).Error
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&liabilityv1.LiabilityPaymentRecordResponse{
		Payment: paymentToProto(&payment),
	}), nil
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
