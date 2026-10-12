package financial_account_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

var (
	errSameAccount = connect.NewError(connect.CodeInvalidArgument, errors.New("pick two different accounts"))

	errIntoUnknown = connect.NewError(connect.CodeInvalidArgument, errors.New("money cannot go INTO an unknown account — name its bank first"))
)

// FinancialAccountTransfer moves money between two of the team's accounts: two rows, one act — `transfer`
// out of one, `transfer` into the other, sharing a group id (opening-transfer-and-team-payment-join-the-types).
//
// Both must be this team's and active; never the same one; never INTO an unknown account (an unknown account
// is transferred OUT of, a-shop-with-no-account-gets-an-unknown-one). Below zero is allowed — warned on
// screen, never refused (below-zero-is-warned-never-refused).
func (s *Service) FinancialAccountTransfer(
	ctx context.Context,
	req *connect.Request[financial_accountv1.FinancialAccountTransferRequest],
) (*connect.Response[financial_accountv1.FinancialAccountTransferResponse], error) {
	msg := req.Msg

	if msg.GetFromAccountId() == msg.GetToAccountId() {
		return nil, errSameAccount
	}

	if !validAmount(msg.GetAmount()) {
		return nil, errNoAmount
	}

	occurredAt, err := s.pickedDay(msg.GetOccurredOn())
	if err != nil {
		return nil, err
	}

	actor := actorFrom(ctx)
	out := []*financial_accountv1.FinancialAccountLog{}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		locked, err := lockAccounts(tx, msg.GetTeamId(), msg.GetFromAccountId(), msg.GetToAccountId())
		if err != nil {
			return err
		}

		from := locked[msg.GetFromAccountId()]
		to := locked[msg.GetToAccountId()]

		if to.Type == m.TypeUnknown {
			return errIntoUnknown
		}

		for _, a := range []*m.FinancialAccount{from, to} {
			if a.Status != m.StatusActive {
				return errArchived(a.Name)
			}
		}

		legs, err := transferLegs(tx, from, to, rupiah(msg.GetAmount()), occurredAt, msg.GetNote(), actor)
		if err != nil {
			return err
		}

		for _, leg := range legs {
			out = append(out, logToProto(leg))
		}

		return nil
	})
	if err != nil {
		return nil, uniqueOrInternal(err)
	}

	return connect.NewResponse(&financial_accountv1.FinancialAccountTransferResponse{Logs: out}), nil
}
