package mcp_service

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"connectrpc.com/connect"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
)

// THE LOOKUPS beside the metric pair (the-agent-reads-through-the-metric-pattern): the reads that turn a name or a
// reference into an id, and what the team owes and is owed. Each is one RPC the screens already call.

type pageIn struct {
	Page  uint32 `json:"page,omitempty" jsonschema:"page number, from 1 — default 1"`
	Limit uint32 `json:"limit,omitempty" jsonschema:"rows per page, 1 to 100 — default 20"`
}

func (p pageIn) pagination() *commonv1.CommonPagination {
	page := max(p.Page, 1)

	limit := p.Limit
	switch {
	case limit == 0:
		limit = 20
	case limit > 100:
		limit = 100
	}

	return &commonv1.CommonPagination{Page: page, Limit: limit}
}

// ── list_teams ────────────────────────────────────────────────────────────────────────────────────────────────────

type listTeamsIn struct {
	Q string `json:"q,omitempty" jsonschema:"part of a team's name"`
	pageIn
}

// ⚠ My build detail, beside the decided lookups: a connection to EVERY team (root's) must name a team on every read,
// and nothing else turns a team's name into its id. A one-team connection is answered its own team alone.
func (t *tools) addListTeams(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:  "list_teams",
		Title: "List the teams",
		Description: "The teams this connection reads, with their ids and types — its one team, or every team for a " +
			"connection made by root. Pass a team's id as team_id to the other tools.",
		Annotations: readOnlyTool,
	}, func(ctx context.Context, req *mcp.CallToolRequest, in listTeamsIn) (*mcp.CallToolResult, any, error) {
		c, cancel, err := t.begin(ctx, req)
		if err != nil {
			return nil, nil, err
		}
		defer cancel()

		if c.grant.TeamID != 0 {
			res, err := t.clients.Teams.TeamByIds(c.ctx, connect.NewRequest(&teamv1.TeamByIdsRequest{
				Filter:      &teamv1.TeamByIdsFilter{Ids: []uint64{c.grant.TeamID}},
				DataRequest: []teamv1.TeamByIdsDataType{teamv1.TeamByIdsDataType_TEAM_BY_IDS_DATA_TYPE_TEAM},
			}))
			if err != nil {
				return nil, nil, rpcError(err)
			}

			return asText(res.Msg)
		}

		res, err := t.clients.Teams.TeamList(c.ctx, connect.NewRequest(&teamv1.TeamListRequest{
			Filter:      &teamv1.TeamListFilter{Q: strings.TrimSpace(in.Q)},
			DataRequest: []teamv1.TeamListDataType{teamv1.TeamListDataType_TEAM_LIST_DATA_TYPE_TEAM},
			Page:        in.pagination(),
		}))
		if err != nil {
			return nil, nil, rpcError(err)
		}

		return asText(res.Msg)
	})
}

// ── search_products ───────────────────────────────────────────────────────────────────────────────────────────────

type searchProductsIn struct {
	TeamID   uint64 `json:"team_id,omitempty" jsonschema:"the team whose catalogue to search — omit for the connection's own team"`
	Q        string `json:"q,omitempty" jsonschema:"part of a product's name or code"`
	Archived bool   `json:"archived,omitempty" jsonschema:"search the archived products instead of the live ones"`
	pageIn
}

func (t *tools) addSearchProducts(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:  "search_products",
		Title: "Search the products",
		Description: "A team's products by name or code — each with its id, code and name. Use the id as product_id " +
			"in read_metric.",
		Annotations: readOnlyTool,
	}, func(ctx context.Context, req *mcp.CallToolRequest, in searchProductsIn) (*mcp.CallToolResult, any, error) {
		c, cancel, err := t.begin(ctx, req)
		if err != nil {
			return nil, nil, err
		}
		defer cancel()

		team, err := c.team(in.TeamID)
		if err != nil {
			return nil, nil, err
		}

		status := productv1.ProductStatus_PRODUCT_STATUS_ACTIVE
		if in.Archived {
			status = productv1.ProductStatus_PRODUCT_STATUS_ARCHIVED
		}

		res, err := t.clients.Products.ProductList(c.ctx, connect.NewRequest(&productv1.ProductListRequest{
			TeamId:      team,
			Filter:      &productv1.ProductListFilter{Q: strings.TrimSpace(in.Q), Status: status},
			DataRequest: []productv1.ProductListDataType{productv1.ProductListDataType_PRODUCT_LIST_DATA_TYPE_PRODUCT},
			Page:        in.pagination(),
		}))
		if err != nil {
			return nil, nil, rpcError(err)
		}

		return asText(res.Msg)
	})
}

// ── find_orders ───────────────────────────────────────────────────────────────────────────────────────────────────

type findOrdersIn struct {
	TeamID uint64   `json:"team_id,omitempty" jsonschema:"the selling team whose orders to look in — omit for the connection's own team"`
	Refs   []string `json:"refs" jsonschema:"1 to 20 marketplace order references, as the marketplace shows them"`
}

var errRefs = errors.New("name 1 to 20 marketplace references")

// maxRefs bounds one look-up: each found order is one more read.
const maxRefs = 20

// An order reaches the agent WHOLE — the buyer's name, phone and address included (buyer-data-reaches-the-agent).
func (t *tools) addFindOrders(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:  "find_orders",
		Title: "Find orders by their marketplace reference",
		Description: "A selling team's orders by the reference the marketplace gave them — each order whole, as the " +
			"order screen shows it: its lines, its money, its status and timeline, and the buyer's details. A reference " +
			"no order carries is listed under not_found.",
		Annotations: readOnlyTool,
	}, func(ctx context.Context, req *mcp.CallToolRequest, in findOrdersIn) (*mcp.CallToolResult, any, error) {
		c, cancel, err := t.begin(ctx, req)
		if err != nil {
			return nil, nil, err
		}
		defer cancel()

		refs := distinct(in.Refs)
		if len(refs) == 0 || len(refs) > maxRefs {
			return nil, nil, errRefs
		}

		team, err := c.team(in.TeamID)
		if err != nil {
			return nil, nil, err
		}

		found, err := t.clients.Orders.OrderByExternalRefs(c.ctx, connect.NewRequest(&sellingv1.OrderByExternalRefsRequest{
			TeamId:      team,
			Filter:      &sellingv1.OrderByExternalRefsFilter{Refs: refs},
			DataRequest: []sellingv1.OrderByExternalRefsDataType{sellingv1.OrderByExternalRefsDataType_ORDER_BY_EXTERNAL_REFS_DATA_TYPE_ORDER_REF},
		}))
		if err != nil {
			return nil, nil, rpcError(err)
		}

		orders := map[string][]json.RawMessage{}
		var missing []string

		for _, ref := range refs {
			ids := orderIDsOf(found.Msg.GetItems()[ref])
			if len(ids) == 0 {
				missing = append(missing, ref)

				continue
			}

			for _, id := range ids {
				detail, err := t.clients.Orders.OrderDetail(c.ctx, connect.NewRequest(&sellingv1.OrderDetailRequest{TeamId: team, OrderId: id}))
				if err != nil {
					return nil, nil, rpcError(err)
				}

				body, err := jsonMarshaler.Marshal(detail.Msg.GetOrder())
				if err != nil {
					return nil, nil, err
				}

				orders[ref] = append(orders[ref], body)
			}
		}

		answer, err := json.Marshal(map[string]any{"orders": orders, "not_found": missing})
		if err != nil {
			return nil, nil, err
		}

		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(answer)}}}, nil, nil
	})
}

func orderIDsOf(list *sellingv1.OrderByExternalRefsResponseList) []uint64 {
	var ids []uint64

	for _, item := range list.GetItems() {
		for id := range item.GetOrderRef().GetMapData() {
			ids = append(ids, id)
		}
	}

	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })

	return ids
}

func distinct(values []string) []string {
	seen := map[string]bool{}

	var out []string

	for _, v := range values {
		v = strings.TrimSpace(v)
		if v == "" || seen[v] {
			continue
		}

		seen[v] = true
		out = append(out, v)
	}

	return out
}

// ── balance_positions ─────────────────────────────────────────────────────────────────────────────────────────────

type balancePositionsIn struct {
	TeamID        uint64 `json:"team_id,omitempty" jsonschema:"the team whose balance to read — omit for the connection's own team"`
	UnsettledOnly bool   `json:"unsettled_only,omitempty" jsonschema:"only the counterparties the team is not square with"`
	pageIn
}

func (t *tools) addBalancePositions(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:  "balance_positions",
		Title: "Read the team balance positions",
		Description: "What the team owes other teams and is owed by them — one row per counterparty, in rupiah: a " +
			"positive balance is owed TO the team, a negative one BY it — with the totals across every counterparty, " +
			"when the oldest unsettled debt began, and the payments waiting for the team to confirm.",
		Annotations: readOnlyTool,
	}, func(ctx context.Context, req *mcp.CallToolRequest, in balancePositionsIn) (*mcp.CallToolResult, any, error) {
		c, cancel, err := t.begin(ctx, req)
		if err != nil {
			return nil, nil, err
		}
		defer cancel()

		team, err := c.team(in.TeamID)
		if err != nil {
			return nil, nil, err
		}

		res, err := t.clients.Liability.LiabilityPositionList(c.ctx, connect.NewRequest(&liabilityv1.LiabilityPositionListRequest{
			TeamId:      team,
			Filter:      &liabilityv1.LiabilityPositionListFilter{UnsettledOnly: in.UnsettledOnly},
			DataRequest: []liabilityv1.LiabilityPositionListDataType{liabilityv1.LiabilityPositionListDataType_LIABILITY_POSITION_LIST_DATA_TYPE_POSITION},
			Page:        in.pagination(),
		}))
		if err != nil {
			return nil, nil, rpcError(err)
		}

		return asText(res.Msg)
	})
}
