package financial_account_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

var errUnknownOperational = connect.NewError(connect.CodeInvalidArgument, errors.New("an unknown account cannot pay for operations"))

// FinancialAccountOperationalSet marks or unmarks an account as one that pays for operations —
// `operational_accounts` (operational-accounts-pay-for-operations); a restock's Paid from picks among the
// marked ones. Marking is refused on an archived account and on an unknown one; unmarking never is. Both are
// idempotent — marking a marked account changes nothing.
func (s *Service) FinancialAccountOperationalSet(
	ctx context.Context,
	req *connect.Request[financial_accountv1.FinancialAccountOperationalSetRequest],
) (*connect.Response[financial_accountv1.FinancialAccountOperationalSetResponse], error) {
	msg := req.Msg

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		account, err := lockAccount(tx, msg.GetTeamId(), msg.GetAccountId())
		if err != nil {
			return err
		}

		if !msg.GetOperational() {
			return tx.Where("account_id = ?", account.ID).Delete(&m.OperationalAccount{}).Error
		}

		if account.Status != m.StatusActive {
			return errArchived(account.Name)
		}

		if account.Type == m.TypeUnknown {
			return errUnknownOperational
		}

		return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "account_id"}}, DoNothing: true}).
			Create(&m.OperationalAccount{TeamID: account.TeamID, AccountID: account.ID}).
			Error
	})
	if err != nil {
		return nil, uniqueOrInternal(err)
	}

	account, err := reloadAccount(s.db.WithContext(ctx), msg.GetAccountId())
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&financial_accountv1.FinancialAccountOperationalSetResponse{Account: account}), nil
}
