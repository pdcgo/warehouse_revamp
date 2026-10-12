package financial_account_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// FinancialAccountRestore puts an archived account back — same id, same rows, into the pickers again. No
// confirm on the screen: archiving it again undoes it. Its operational mark does not come back by itself.
func (s *Service) FinancialAccountRestore(
	ctx context.Context,
	req *connect.Request[financial_accountv1.FinancialAccountRestoreRequest],
) (*connect.Response[financial_accountv1.FinancialAccountRestoreResponse], error) {
	msg := req.Msg

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		account, err := lockAccount(tx, msg.GetTeamId(), msg.GetAccountId())
		if err != nil {
			return err
		}

		return tx.Model(&m.FinancialAccount{}).
			Where("id = ?", account.ID).
			Updates(map[string]any{"status": m.StatusActive, "updated_at": gorm.Expr("NOW()")}).
			Error
	})
	if err != nil {
		return nil, uniqueOrInternal(err)
	}

	account, err := reloadAccount(s.db.WithContext(ctx), msg.GetAccountId())
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&financial_accountv1.FinancialAccountRestoreResponse{Account: account}), nil
}
