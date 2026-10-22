package main

import (
	"context"

	"connectrpc.com/connect"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	warehouse_v1 "github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_v1"
)

// ── warehouse_service — a warehouse's name, for a refusal ───────────────────────────────────────────────────────

type warehouseNames struct {
	teams teamv1connect.TeamServiceClient
}

// NewWarehouseNamer names a warehouse for WarehouseFeeCalculate's refusal ("Gudang A has not set its fee"), asking
// team_service AS THE CALLER (san_auth.ForwardBearer) — TeamByIds is allow_only_authenticated.
func NewWarehouseNamer(cfg *Config, client *internalHTTPClient) warehouse_v1.WarehouseNamer {
	return &warehouseNames{
		teams: teamv1connect.NewTeamServiceClient(client, cfg.InternalBaseURL,
			connect.WithInterceptors(san_auth.ForwardBearer())),
	}
}

func (a *warehouseNames) WarehouseName(ctx context.Context, warehouseID uint64) (string, error) {
	resp, err := a.teams.TeamByIds(ctx, connect.NewRequest(&teamv1.TeamByIdsRequest{
		Filter:      &teamv1.TeamByIdsFilter{Ids: []uint64{warehouseID}},
		DataRequest: []teamv1.TeamByIdsDataType{teamv1.TeamByIdsDataType_TEAM_BY_IDS_DATA_TYPE_GENERAL},
	}))
	if err != nil {
		return "", err
	}

	for _, item := range resp.Msg.GetItems()[warehouseID].GetItems() {
		if general := item.GetGeneral().GetMapData()[warehouseID]; general != nil {
			return general.GetName(), nil
		}
	}

	return "", nil
}
