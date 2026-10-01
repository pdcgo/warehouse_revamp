package financial_account_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// FinancialAccountUpdate edits name, holder and description. Provider and number are FIXED — another number
// is another account — so the request carries neither.
func (s *Service) FinancialAccountUpdate(
	ctx context.Context,
	req *connect.Request[financial_accountv1.FinancialAccountUpdateRequest],
) (*connect.Response[financial_accountv1.FinancialAccountUpdateResponse], error) {
	msg := req.Msg

	name, err := cleanName(msg.GetName())
	if err != nil {
		return nil, err
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		account, err := lockAccount(tx, msg.GetTeamId(), msg.GetAccountId())
		if err != nil {
			return err
		}

		err = nameFree(tx, account.TeamID, name, account.ID)
		if err != nil {
			return err
		}

		return tx.Model(&m.FinancialAccount{}).
			Where("id = ?", account.ID).
			Updates(map[string]any{
				"name":        name,
				"holder_name": strings.TrimSpace(msg.GetHolderName()),
				"description": msg.GetDescription(),
				"updated_at":  gorm.Expr("NOW()"),
			}).
			Error
	})
	if err != nil {
		return nil, uniqueOrInternal(err)
	}

	account, err := reloadAccount(s.db.WithContext(ctx), msg.GetAccountId())
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&financial_accountv1.FinancialAccountUpdateResponse{Account: account}), nil
}
