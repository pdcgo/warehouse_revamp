package main

import (
	"context"

	"connectrpc.com/connect"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1/financial_accountv1connect"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// liability's two outside questions (docs/services/liability_service/rpc.md), both asked over Connect under the
// CALLER's token — a client, not the handler in-process, so the services stay independent and the Wire graph has
// no cycle:
//
//   - is the account a payment names — *Paid from* on record, *Received into* on accept — one of the team's own
//     live accounts? (a-team-payment-posts-on-accept) — financial_account_service;
//   - what are these creditors called? (the-debtor-sees-the-limits-set-on-it) — team_service.

// NewFinancialAccountClient is how other services ask the financial accounts — under the caller's own token.
func NewFinancialAccountClient(cfg *Config, client *internalHTTPClient) financial_accountv1connect.FinancialAccountServiceClient {
	return financial_accountv1connect.NewFinancialAccountServiceClient(
		client,
		cfg.InternalBaseURL,
		connect.WithInterceptors(san_auth.ForwardBearer()),
	)
}

// liabilityAccounts answers liability's AccountChecker with FinancialAccountByIds — scoped to the team, so
// another team's account is simply absent from the answer, and refused alike with one that does not exist.
type liabilityAccounts struct {
	accounts financial_accountv1connect.FinancialAccountServiceClient
}

func NewLiabilityAccountChecker(accounts financial_accountv1connect.FinancialAccountServiceClient) liability_v1.AccountChecker {
	return &liabilityAccounts{accounts: accounts}
}

// PaymentAccount is what the account picker offers, asked again: the team's, ACTIVE, and never `unknown` —
// money does not go into, or out of a payment through, an account whose bank nobody has named.
func (c *liabilityAccounts) PaymentAccount(ctx context.Context, teamID, accountID uint64) (bool, error) {
	resp, err := c.accounts.FinancialAccountByIds(ctx, connect.NewRequest(&financial_accountv1.FinancialAccountByIdsRequest{
		TeamId: teamID,
		Filter: &financial_accountv1.FinancialAccountByIdsFilter{Ids: []uint64{accountID}},
		DataRequest: []financial_accountv1.FinancialAccountByIdsDataType{
			financial_accountv1.FinancialAccountByIdsDataType_FINANCIAL_ACCOUNT_BY_IDS_DATA_TYPE_ACCOUNT,
		},
	}))
	if err != nil {
		return false, err
	}

	for _, item := range resp.Msg.GetItems()[accountID].GetItems() {
		account := item.GetAccount().GetMapData()[accountID]
		if account == nil {
			continue
		}

		return account.GetTeamId() == teamID &&
			account.GetStatus() == financial_accountv1.FinancialAccountStatus_FINANCIAL_ACCOUNT_STATUS_ACTIVE &&
			account.GetType() != financial_accountv1.FinancialAccountType_FINANCIAL_ACCOUNT_TYPE_UNKNOWN, nil
	}

	// Not answered: another team's account, or none at all.
	return false, nil
}

// liabilityTeamNames answers liability's TeamNamer with TeamByIds — the creditor names of LiabilityCreditByIds'
// GENERAL slice (the-debtor-sees-the-limits-set-on-it). Asked AS THE CALLER (san_auth.ForwardBearer): TeamByIds is
// allow_only_authenticated, and the names are what that person may read anyway.
type liabilityTeamNames struct {
	teams teamv1connect.TeamServiceClient
}

func NewLiabilityTeamNamer(cfg *Config, client *internalHTTPClient) liability_v1.TeamNamer {
	return &liabilityTeamNames{
		teams: teamv1connect.NewTeamServiceClient(client, cfg.InternalBaseURL,
			connect.WithInterceptors(san_auth.ForwardBearer())),
	}
}

func (a *liabilityTeamNames) TeamNames(ctx context.Context, ids []uint64) (map[uint64]string, error) {
	out := map[uint64]string{}
	if len(ids) == 0 {
		return out, nil
	}

	resp, err := a.teams.TeamByIds(ctx, connect.NewRequest(&teamv1.TeamByIdsRequest{
		Filter:      &teamv1.TeamByIdsFilter{Ids: ids},
		DataRequest: []teamv1.TeamByIdsDataType{teamv1.TeamByIdsDataType_TEAM_BY_IDS_DATA_TYPE_GENERAL},
	}))
	if err != nil {
		return nil, err
	}

	// An unknown or deleted team is absent from TeamByIds, and so from this — its GENERAL item carries the id alone.
	for _, list := range resp.Msg.GetItems() {
		for _, item := range list.GetItems() {
			for id, general := range item.GetGeneral().GetMapData() {
				out[id] = general.GetName()
			}
		}
	}

	return out, nil
}
