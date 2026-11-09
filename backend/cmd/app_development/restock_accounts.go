package main

import (
	"context"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// restockPayingAccounts answers inventory's PayingAccounts from financial_account_service: the account a restock — or a
// warehouse transfer's shipping — names as having paid, its name, whether it is active and whether the team marked it
// operational (a-restock-names-its-paying-account, a-transfer-names-its-paying-account,
// operational-accounts-pay-for-operations). inventory_service never reads the
// accounts' tables; this adapter is the whole dependency.
//
// The same in-process FinancialAccountByIds lookup as expense's Paid from (teamAccount in expense_accounts.go): the
// restock or transfer RPC has already run its own policy against the caller's team, and ByIds is scoped to that same team —
// another team's account is simply absent, which reads as one that never existed.
type restockPayingAccounts struct {
	accounts *financial_account_v1.Service
}

func NewRestockPayingAccounts(accounts *financial_account_v1.Service) inventory_v1.PayingAccounts {
	return &restockPayingAccounts{accounts: accounts}
}

func (a *restockPayingAccounts) Account(
	ctx context.Context,
	teamID, accountID uint64,
) (inventory_v1.PayingAccount, bool, error) {
	row, err := teamAccount(ctx, a.accounts, teamID, accountID)
	if err != nil || row == nil {
		return inventory_v1.PayingAccount{}, false, err
	}

	return inventory_v1.PayingAccount{
		Name:        row.GetName(),
		Active:      row.GetStatus() == financial_accountv1.FinancialAccountStatus_FINANCIAL_ACCOUNT_STATUS_ACTIVE,
		Operational: row.GetOperational(),
	}, true, nil
}
