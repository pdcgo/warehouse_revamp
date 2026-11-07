package main

import (
	"context"

	"connectrpc.com/connect"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1/financial_accountv1connect"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
	team_v1 "github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
)

// liability's two outside questions (docs/services/liability_service/rpc.md):
//
//   - is the account a payment names — *Paid from* on record, *Received into* on accept — one of the team's own
//     live accounts? (a-team-payment-posts-on-accept) — financial_account_service, over Connect under the CALLER's
//     token;
//   - what are these teams called, and what kind of team is each? (the-debtor-sees-the-limits-set-on-it; the pair
//     list's search and kind filter, backlog #34) — team_service, its TeamByIds handler called in-process.

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

// liabilityTeamNames answers liability's TeamNamer from team_service's TeamByIds — the creditor names of
// LiabilityCreditByIds' GENERAL slice (the-debtor-sees-the-limits-set-on-it), and the name, code and type the pair
// list's search and kind filter read (backlog #34).
//
// It calls the HANDLER in-process, as inventoryProductReader calls product_service's: the liability RPC asking has
// already run its own policy against the caller's team, and TeamByIds is an unscoped, any-authenticated read of what
// that person may see anyway — so a loopback HTTP hop per search would buy nothing. liability never reads `teams`.
type liabilityTeamNames struct {
	teams *team_v1.Service
}

func NewLiabilityTeamNamer(teams *team_v1.Service) liability_v1.TeamNamer {
	return &liabilityTeamNames{teams: teams}
}

// teamByIdsMax is TeamByIds' own cap on ids per call (TeamByIdsFilter.ids). The handler called in-process skips the
// contract's validation, so the batches keep to it anyway — the IN list stays the size the contract promises.
const teamByIdsMax = 200

func (a *liabilityTeamNames) TeamNames(ctx context.Context, ids []uint64) (map[uint64]string, error) {
	out := map[uint64]string{}

	err := a.teamRows(ctx, ids, teamv1.TeamByIdsDataType_TEAM_BY_IDS_DATA_TYPE_GENERAL, func(item *teamv1.TeamByIdsResponseItem) {
		// An unknown or deleted team is absent from TeamByIds, and so from this — its GENERAL item carries the id alone.
		for id, general := range item.GetGeneral().GetMapData() {
			out[id] = general.GetName()
		}
	})
	if err != nil {
		return nil, err
	}

	return out, nil
}

func (a *liabilityTeamNames) TeamFacts(ctx context.Context, ids []uint64) (map[uint64]liability_v1.TeamFact, error) {
	out := map[uint64]liability_v1.TeamFact{}

	err := a.teamRows(ctx, ids, teamv1.TeamByIdsDataType_TEAM_BY_IDS_DATA_TYPE_TEAM, func(item *teamv1.TeamByIdsResponseItem) {
		// Absent for an unknown or deleted team — which then never matches a search.
		for id, team := range item.GetTeam().GetMapData() {
			out[id] = liability_v1.TeamFact{Name: team.GetName(), Code: team.GetTeamCode(), Type: team.GetType()}
		}
	})
	if err != nil {
		return nil, err
	}

	return out, nil
}

// teamRows asks TeamByIds for one slice in batches of teamByIdsMax and hands every item to `each`.
func (a *liabilityTeamNames) teamRows(
	ctx context.Context,
	ids []uint64,
	slice teamv1.TeamByIdsDataType,
	each func(*teamv1.TeamByIdsResponseItem),
) error {
	for start := 0; start < len(ids); start += teamByIdsMax {
		end := min(start+teamByIdsMax, len(ids))

		resp, err := a.teams.TeamByIds(ctx, connect.NewRequest(&teamv1.TeamByIdsRequest{
			Filter:      &teamv1.TeamByIdsFilter{Ids: ids[start:end]},
			DataRequest: []teamv1.TeamByIdsDataType{slice},
		}))
		if err != nil {
			return err
		}

		for _, list := range resp.Msg.GetItems() {
			for _, item := range list.GetItems() {
				each(item)
			}
		}
	}

	return nil
}
