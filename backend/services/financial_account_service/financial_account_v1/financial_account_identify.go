package financial_account_v1

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

var (
	errNotUnknown = connect.NewError(connect.CodeFailedPrecondition, errors.New("only an unknown account is identified"))

	errRecordedMoveIn = connect.NewError(
		connect.CodeAlreadyExists,
		errors.New("this account is already recorded — choose it under “It is one we already have” to move the money into it"),
	)

	errMoveIntoReal = connect.NewError(connect.CodeInvalidArgument, errors.New("move it into a real account of this team"))

	errNoTarget = connect.NewError(connect.CodeInvalidArgument, errors.New("fill it in, or move it into an account"))
)

// FinancialAccountIdentify is the one way an `unknown` account becomes the real one
// (an-unknown-account-is-filled-in-or-moved-in):
//
//   - FILL IN — the real bank is not recorded yet: this account BECOMES it — same id, its rows kept, each
//     withdrawal still on its own day. Type and provider are picked apart, as on New Account
//     (type-and-provider-are-picked-apart supersedes the decision's "type derived").
//   - MOVE IN — it is recorded already: one transaction moves the balance across as a transfer, re-points the
//     shops, and archives the unknown account at zero.
//
// Filling in a number that is already recorded is refused, and the refusal points at MOVE IN.
func (s *Service) FinancialAccountIdentify(
	ctx context.Context,
	req *connect.Request[financial_accountv1.FinancialAccountIdentifyRequest],
) (*connect.Response[financial_accountv1.FinancialAccountIdentifyResponse], error) {
	msg := req.Msg
	actor := actorFrom(ctx)
	resultID := msg.GetAccountId()

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		switch target := msg.GetTarget().(type) {
		case *financial_accountv1.FinancialAccountIdentifyRequest_FillIn:
			fill := target.FillIn

			id, err := checkIdentity(fill.GetType(), fill.GetProvider(), fill.GetAccountNumber())
			if err != nil {
				return err
			}

			name, err := cleanName(fill.GetName())
			if err != nil {
				return err
			}

			unknown, err := lockAccount(tx, msg.GetTeamId(), msg.GetAccountId())
			if err != nil {
				return err
			}

			if unknown.Type != m.TypeUnknown {
				return errNotUnknown
			}

			err = numberFree(tx, id, unknown.ID)
			if err != nil {
				return errRecordedMoveIn
			}

			err = nameFree(tx, unknown.TeamID, name, unknown.ID)
			if err != nil {
				return err
			}

			return tx.Model(&m.FinancialAccount{}).
				Where("id = ?", unknown.ID).
				Updates(map[string]any{
					"type":           id.accountType,
					"provider":       id.provider,
					"account_number": id.number,
					"holder_name":    strings.TrimSpace(fill.GetHolderName()),
					"name":           name,
					"updated_at":     gorm.Expr("NOW()"),
				}).
				Error

		case *financial_accountv1.FinancialAccountIdentifyRequest_MoveIntoAccountId:
			if target.MoveIntoAccountId == msg.GetAccountId() {
				return errMoveIntoReal
			}

			// Both locked, in id order — the move is a transfer, and a transfer locks both.
			locked, err := lockAccounts(tx, msg.GetTeamId(), msg.GetAccountId(), target.MoveIntoAccountId)
			if err != nil {
				return err
			}

			unknown := locked[msg.GetAccountId()]
			real := locked[target.MoveIntoAccountId]

			if unknown.Type != m.TypeUnknown {
				return errNotUnknown
			}

			if real.Type == m.TypeUnknown {
				return errMoveIntoReal
			}

			if real.Status != m.StatusActive {
				return errArchived(real.Name)
			}

			if unknown.Balance != 0 {
				_, err = transferLegs(tx, unknown, real, unknown.Balance, s.now(), "the bank was named", actor)
				if err != nil {
					return err
				}
			}

			err = tx.Model(&m.ShopAccount{}).
				Where("account_id = ?", unknown.ID).
				Updates(map[string]any{"account_id": real.ID, "team_id": real.TeamID, "updated_at": gorm.Expr("NOW()")}).
				Error
			if err != nil {
				return dbError(err)
			}

			// At zero now, so the archive rule holds (an-account-is-archived-only-at-zero).
			err = tx.Model(&m.FinancialAccount{}).
				Where("id = ?", unknown.ID).
				Updates(map[string]any{"status": m.StatusArchived, "updated_at": gorm.Expr("NOW()")}).
				Error
			if err != nil {
				return dbError(err)
			}

			resultID = real.ID

			return nil

		default:
			return errNoTarget
		}
	})
	if err != nil {
		return nil, uniqueOrInternal(err)
	}

	account, err := reloadAccount(s.db.WithContext(ctx), resultID)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&financial_accountv1.FinancialAccountIdentifyResponse{Account: account}), nil
}
