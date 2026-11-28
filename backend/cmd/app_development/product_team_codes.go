package main

import (
	"context"

	"connectrpc.com/connect"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// productTeamCodes answers product_service's one outside question about a team — its code, the prefix every product code
// of that team is composed from (the-field-is-product-code-composed-on-write) — with TeamByIds, asked AS THE CALLER
// (san_auth.ForwardBearer): TeamByIds is allow_only_authenticated, and a product write always carries the writer's token.
//
// Not cached, and that is now LOAD-BEARING: a team's code can change (TeamCodeUpdate,
// a-team-code-change-recomposes-its-product-codes), and every caller reads it under the team's product-code lock
// (product_v1.lockTeamProductCodes), which the change's recompose takes too — a cached code would let a create compose
// from the old one after the change committed. team_service's TeamByIds reads the row itself (no cache there either). A
// code is read once per create, or per correction of a never-used product's code, so a cache would save nothing that
// matters.
type productTeamCodes struct {
	teams teamv1connect.TeamServiceClient
}

func NewProductTeamCodes(cfg *Config, client *internalHTTPClient) product_v1.TeamCodes {
	return &productTeamCodes{
		teams: teamv1connect.NewTeamServiceClient(client, cfg.InternalBaseURL,
			connect.WithInterceptors(san_auth.ForwardBearer())),
	}
}

// TeamCode is "" for a team team_service does not know or has deleted — product_service refuses the write on that.
func (c *productTeamCodes) TeamCode(ctx context.Context, teamID uint64) (string, error) {
	resp, err := c.teams.TeamByIds(ctx, connect.NewRequest(&teamv1.TeamByIdsRequest{
		Filter:      &teamv1.TeamByIdsFilter{Ids: []uint64{teamID}},
		DataRequest: []teamv1.TeamByIdsDataType{teamv1.TeamByIdsDataType_TEAM_BY_IDS_DATA_TYPE_TEAM},
	}))
	if err != nil {
		return "", err
	}

	for _, item := range resp.Msg.GetItems()[teamID].GetItems() {
		if team := item.GetTeam().GetMapData()[teamID]; team != nil {
			return team.GetTeamCode(), nil
		}
	}

	return "", nil
}
