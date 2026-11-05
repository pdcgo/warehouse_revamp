package main

import (
	"context"

	"connectrpc.com/connect"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// expensePayingAccounts answers expense's PayingAccounts from financial_account_service: the account an expense names
// as having paid, its name, whether it is active and whether the team marked it operational
// (an-expense-must-name-the-account-that-paid, operational-accounts-pay-for-operations). expense_service never reads
// the accounts' tables; this adapter is the whole dependency.
//
// It calls FinancialAccountByIds in-process, as inventoryProductReader calls ProductByIds: the calling RPC has already
// run its own policy against the caller's team, and ByIds is scoped to that same team — another team's account is
// simply absent, which reads as one that never existed.
type expensePayingAccounts struct {
	accounts *financial_account_v1.Service
}

func NewExpensePayingAccounts(accounts *financial_account_v1.Service) expense_v1.PayingAccounts {
	return &expensePayingAccounts{accounts: accounts}
}

func (a *expensePayingAccounts) Account(
	ctx context.Context,
	teamID, accountID uint64,
) (expense_v1.PayingAccount, bool, error) {
	row, err := teamAccount(ctx, a.accounts, teamID, accountID)
	if err != nil || row == nil {
		return expense_v1.PayingAccount{}, false, err
	}

	return expense_v1.PayingAccount{
		Name:        row.GetName(),
		Active:      row.GetStatus() == financial_accountv1.FinancialAccountStatus_FINANCIAL_ACCOUNT_STATUS_ACTIVE,
		Operational: row.GetOperational(),
	}, true, nil
}

// teamAccount reads one of the team's accounts through FinancialAccountByIds, in-process — the one lookup both paying
// account seams share (expense's here, the restock's in restock_accounts.go). nil means absent: another team's or
// unknown, which must read the same.
func teamAccount(
	ctx context.Context,
	accounts *financial_account_v1.Service,
	teamID, accountID uint64,
) (*financial_accountv1.FinancialAccount, error) {
	res, err := accounts.FinancialAccountByIds(ctx, connect.NewRequest(&financial_accountv1.FinancialAccountByIdsRequest{
		TeamId: teamID,
		Filter: &financial_accountv1.FinancialAccountByIdsFilter{Ids: []uint64{accountID}},
		DataRequest: []financial_accountv1.FinancialAccountByIdsDataType{
			financial_accountv1.FinancialAccountByIdsDataType_FINANCIAL_ACCOUNT_BY_IDS_DATA_TYPE_ACCOUNT,
		},
	}))
	if err != nil {
		return nil, err
	}

	for _, item := range res.Msg.GetItems()[accountID].GetItems() {
		row := item.GetAccount().GetMapData()[accountID]
		if row != nil {
			return row, nil
		}
	}

	return nil, nil
}
