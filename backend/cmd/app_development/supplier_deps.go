package main

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1/supplierv1connect"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// The supplier's two outside questions, and the one other services ask it
// (the-supplier-gets-its-own-service, docs/services/supplier_service/rpc.md).
//
//   - supplier_service asks team_service whether a team is a SELLING team, before SupplierCreate writes.
//   - inventory_service asks supplier_service whether a restock's supplier is live, before a restock names it.
//
// Both over Connect under the CALLER's token — a client, not the handler in-process, so the services stay
// independent and the Wire graph has no cycle.

// NewSupplierClient is how other services ask the supplier — under the caller's own token.
func NewSupplierClient(cfg *Config, client *internalHTTPClient) supplierv1connect.SupplierServiceClient {
	return supplierv1connect.NewSupplierServiceClient(
		client,
		cfg.InternalBaseURL,
		connect.WithInterceptors(san_auth.ForwardBearer()),
	)
}

// inventorySuppliers answers inventory's SupplierChecker with SupplierByIds — the one supplier read that
// returns a deleted supplier, marked, so "deleted" and "unknown" are told apart here and refused alike.
type inventorySuppliers struct {
	suppliers supplierv1connect.SupplierServiceClient
}

func NewInventorySupplierChecker(suppliers supplierv1connect.SupplierServiceClient) inventory_v1.SupplierChecker {
	return &inventorySuppliers{suppliers: suppliers}
}

func (c *inventorySuppliers) SupplierIsLive(ctx context.Context, teamID, supplierID uint64) (bool, error) {
	resp, err := c.suppliers.SupplierByIds(ctx, connect.NewRequest(&supplierv1.SupplierByIdsRequest{
		TeamId: teamID,
		Filter: &supplierv1.SupplierByIdsFilter{Ids: []uint64{supplierID}},
	}))
	if err != nil {
		return false, err
	}

	for _, item := range resp.Msg.GetItems()[supplierID].GetItems() {
		if supplier := item.GetSupplier().GetMapData()[supplierID]; supplier != nil {
			return !supplier.GetDeleted(), nil
		}
	}

	return false, nil
}

// supplierSellingTeams answers supplier's SellingTeams with TeamByIds. NewTeamClient forwards no token —
// user_service's resolver sets it by hand, and so does this — so the bearer is copied off the context.
type supplierSellingTeams struct {
	teams teamv1connect.TeamServiceClient
}

func NewSupplierSellingTeams(teams teamv1connect.TeamServiceClient) supplier_v1.SellingTeams {
	return &supplierSellingTeams{teams: teams}
}

func (c *supplierSellingTeams) IsSelling(ctx context.Context, teamID uint64) (bool, error) {
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
			return team.GetType() == teamv1.TeamType_TEAM_TYPE_SELLING, nil
		}
	}

	// An unknown team is not a selling team.
	return false, nil
}
