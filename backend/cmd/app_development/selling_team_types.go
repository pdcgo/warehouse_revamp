package main

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// sellingTeamTypes answers the order metrics' one outside question — is the reading team a warehouse
// (a-warehouse-reads-the-orders-it-ships, a-warehouse-sees-no-seller-money) — with TeamByIds, as supplier's
// SellingTeams does. NewTeamClient forwards no token, so the bearer is copied off the context.
type sellingTeamTypes struct {
	teams teamv1connect.TeamServiceClient
}

func NewSellingTeamTypes(teams teamv1connect.TeamServiceClient) selling_v1.TeamTypeReader {
	return &sellingTeamTypes{teams: teams}
}

func (c *sellingTeamTypes) IsWarehouse(ctx context.Context, teamID uint64) (bool, error) {
	bearer := san_auth.GetBearer(ctx)
	if bearer == "" {
		return false, errors.New("no caller token to ask team_service with")
	}

	req := connect.NewRequest(&teamv1.TeamByIdsRequest{
		Filter:      &teamv1.TeamByIdsFilter{Ids: []uint64{teamID}},
		DataRequest: []teamv1.TeamByIdsDataType{teamv1.TeamByIdsDataType_TEAM_BY_IDS_DATA_TYPE_TEAM},
	})
	req.Header().Set("Authorization", "Bearer "+bearer)

	resp, err := c.teams.TeamByIds(ctx, req)
	if err != nil {
		return false, err
	}

	for _, item := range resp.Msg.GetItems()[teamID].GetItems() {
		if team := item.GetTeam().GetMapData()[teamID]; team != nil {
			return team.GetType() == teamv1.TeamType_TEAM_TYPE_WAREHOUSE, nil
		}
	}

	// An unknown team is no warehouse: it reads as a seller, which finds no orders of its own.
	return false, nil
}
