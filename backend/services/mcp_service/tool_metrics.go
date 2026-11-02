package mcp_service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"connectrpc.com/connect"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_metric"
)

// THE METRIC PATTERN (the-agent-reads-through-the-metric-pattern): one pair of tools over every service that serves
// MetricSearch / MetricData. A metric describes itself — its id, filters, groups and fields — so a new metric reaches
// the agent with no new tool. The pattern is the Analytic screen's (docs/business/analytic/rpc_provide.md).

// metricSource is one service serving the pattern. Its two requests carry the same fields under the same names, of the
// shared analytic_base types, so one builder fills all three.
type metricSource struct {
	name    string
	pkg     protoreflect.FullName
	newReq  func(search bool) proto.Message
	search  func(context.Context, proto.Message) (proto.Message, error)
	data    func(context.Context, proto.Message) (proto.Message, error)
	metrics []metricEntry
}

type metricEntry struct {
	ID       string        `json:"metric_id"`
	Source   string        `json:"source"`
	Filters  []string      `json:"filters_supported"`
	Required []string      `json:"filters_required,omitempty"`
	GroupBy  []string      `json:"group_by"`
	Fields   []metricField `json:"fields"`
}

type metricField struct {
	Name     string `json:"name"`
	StatType string `json:"stat_type"`
	Sortable bool   `json:"sortable,omitempty"`
}

func (t *tools) sources() []*metricSource {
	c := t.clients

	sources := []*metricSource{
		{
			name: "orders",
			pkg:  "warehouse.selling.v1",
			newReq: func(search bool) proto.Message {
				if search {
					return &sellingv1.MetricSearchRequest{}
				}

				return &sellingv1.MetricDataRequest{}
			},
			search: func(ctx context.Context, req proto.Message) (proto.Message, error) {
				res, err := c.OrderAnalytic.MetricSearch(ctx, connect.NewRequest(req.(*sellingv1.MetricSearchRequest)))
				if err != nil {
					return nil, err
				}

				return res.Msg, nil
			},
			data: func(ctx context.Context, req proto.Message) (proto.Message, error) {
				res, err := c.OrderAnalytic.MetricData(ctx, connect.NewRequest(req.(*sellingv1.MetricDataRequest)))
				if err != nil {
					return nil, err
				}

				return res.Msg, nil
			},
		},
		{
			name: "settlement",
			pkg:  "warehouse.settlement.v1",
			newReq: func(search bool) proto.Message {
				if search {
					return &settlementv1.MetricSearchRequest{}
				}

				return &settlementv1.MetricDataRequest{}
			},
			search: func(ctx context.Context, req proto.Message) (proto.Message, error) {
				res, err := c.SettlementAnalytic.MetricSearch(ctx, connect.NewRequest(req.(*settlementv1.MetricSearchRequest)))
				if err != nil {
					return nil, err
				}

				return res.Msg, nil
			},
			data: func(ctx context.Context, req proto.Message) (proto.Message, error) {
				res, err := c.SettlementAnalytic.MetricData(ctx, connect.NewRequest(req.(*settlementv1.MetricDataRequest)))
				if err != nil {
					return nil, err
				}

				return res.Msg, nil
			},
		},
		{
			name: "supplier",
			pkg:  "warehouse.supplier.v1",
			newReq: func(search bool) proto.Message {
				if search {
					return &supplierv1.MetricSearchRequest{}
				}

				return &supplierv1.MetricDataRequest{}
			},
			search: func(ctx context.Context, req proto.Message) (proto.Message, error) {
				res, err := c.SupplierAnalytic.MetricSearch(ctx, connect.NewRequest(req.(*supplierv1.MetricSearchRequest)))
				if err != nil {
					return nil, err
				}

				return res.Msg, nil
			},
			data: func(ctx context.Context, req proto.Message) (proto.Message, error) {
				res, err := c.SupplierAnalytic.MetricData(ctx, connect.NewRequest(req.(*supplierv1.MetricDataRequest)))
				if err != nil {
					return nil, err
				}

				return res.Msg, nil
			},
		},
	}

	for _, source := range sources {
		source.metrics = catalogOf(source)
	}

	return sources
}

// catalogOf reads the metrics a source's package declares, off the descriptors linked into the binary.
func catalogOf(source *metricSource) []metricEntry {
	var out []metricEntry

	protoregistry.GlobalFiles.RangeFilesByPackage(source.pkg, func(file protoreflect.FileDescriptor) bool {
		messages := file.Messages()

		for i := range messages.Len() {
			message := messages.Get(i)

			option := san_metric.OptionOf(message)
			if option == nil {
				continue
			}

			entry := metricEntry{ID: option.GetMetricId(), Source: source.name}

			for _, f := range option.GetSupportedFilters() {
				entry.Filters = append(entry.Filters, strings.TrimPrefix(f.String(), "FILTER_TYPE_"))
			}

			for _, f := range option.GetRequiredFilters() {
				entry.Required = append(entry.Required, strings.TrimPrefix(f.String(), "FILTER_TYPE_"))
			}

			for _, g := range option.GetSupportedGroupBy() {
				entry.GroupBy = append(entry.GroupBy, strings.TrimPrefix(g.String(), "GROUP_TYPE_"))
			}

			for _, field := range san_metric.Fields(message) {
				entry.Fields = append(entry.Fields, metricField{
					Name:     field.Name,
					StatType: strings.TrimPrefix(field.StatType.String(), "FIELD_STAT_TYPE_"),
					Sortable: field.CanSort,
				})
			}

			out = append(out, entry)
		}

		return true
	})

	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })

	return out
}

// ── list_metrics ──────────────────────────────────────────────────────────────────────────────────────────────────

func (t *tools) addListMetrics(server *mcp.Server) {
	sources := t.sources()

	var all []metricEntry
	for _, source := range sources {
		all = append(all, source.metrics...)
	}

	body, _ := json.Marshal(map[string]any{
		"metrics": all,
		"stat_types": map[string]string{
			"QTY":      "a count of things — units, orders",
			"CURRENCY": "rupiah that moved in the period — sums across days",
			"POSITION": "rupiah at a moment, a balance — sums across keys, never across days",
			"RATIO":    "0 to 1, a share",
		},
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:  "list_metrics",
		Title: "List the metrics",
		Description: "Every metric that can be read: its id, its source, the filters it supports (and requires), " +
			"the groups it can be read by, and its number fields with what kind of number each is. Read one with read_metric.",
		Annotations: readOnlyTool,
	}, func(ctx context.Context, req *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
		_, cancel, err := t.begin(ctx, req)
		if err != nil {
			return nil, nil, err
		}
		defer cancel()

		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(body)}}}, nil, nil
	})
}

// ── read_metric ───────────────────────────────────────────────────────────────────────────────────────────────────

type readMetricIn struct {
	TeamID    uint64   `json:"team_id,omitempty" jsonschema:"the team to read — omit for the connection's own team"`
	MetricIDs []string `json:"metric_ids" jsonschema:"1 to 5 metric ids from list_metrics, all of one source"`
	GroupBy   string   `json:"group_by" jsonschema:"SUMMARY for the headline, or DAILY, WEEKLY, MONTHLY, YEARLY, PRODUCT, SHOP, SUPPLIER, TEAM, USER, WAREHOUSE — one the metric lists"`
	DateMin   string   `json:"date_min,omitempty" jsonschema:"first day, yyyy-mm-dd, Asia/Jakarta, inclusive — a range is a year at most"`
	DateMax   string   `json:"date_max,omitempty" jsonschema:"last day, yyyy-mm-dd, Asia/Jakarta, inclusive"`

	ProductID   uint64 `json:"product_id,omitempty" jsonschema:"narrow to one product (search_products gives ids)"`
	ShopID      uint64 `json:"shop_id,omitempty" jsonschema:"narrow to one shop"`
	SupplierID  uint64 `json:"supplier_id,omitempty" jsonschema:"narrow to one supplier"`
	WarehouseID uint64 `json:"warehouse_id,omitempty" jsonschema:"narrow to one warehouse"`
	UserID      uint64 `json:"user_id,omitempty" jsonschema:"narrow to one user"`
	ForTeamID   uint64 `json:"filter_team_id,omitempty" jsonschema:"narrow to one team, for a root reading across teams"`

	SortField string `json:"sort_field,omitempty" jsonschema:"for a grouped read: a sortable field of the first metric to rank by — default its first sortable field"`
	Ascending bool   `json:"ascending,omitempty" jsonschema:"rank smallest first — default largest first"`
	Limit     int32  `json:"limit,omitempty" jsonschema:"rows for a grouped read, 1 to 100 — default 20"`
	Offset    int32  `json:"offset,omitempty" jsonschema:"rows to skip, for the next page"`
}

var (
	errNoMetric     = errors.New("name 1 to 5 metric_ids from list_metrics")
	errMixedSources = errors.New("read the metrics of one source at a time — list_metrics says each one's source")
	errNoSortField  = errors.New("the first metric has no sortable field to rank a grouped read by")
)

func (t *tools) addReadMetric(server *mcp.Server) {
	sources := t.sources()
	byID := map[string]*metricSource{}
	entryOf := map[string]metricEntry{}

	for _, source := range sources {
		for _, entry := range source.metrics {
			byID[entry.ID] = source
			entryOf[entry.ID] = entry
		}
	}

	mcp.AddTool(server, &mcp.Tool{
		Name:  "read_metric",
		Title: "Read a metric",
		Description: "Read 1 to 5 metrics of one source, for a date range, as the headline (group_by SUMMARY) or by a group — " +
			"a grouped read is ranked by one field and paged. Money is rupiah; days are Asia/Jakarta. The answer says how " +
			"fresh the figures are (as_of_unix) and whether another page follows.",
		Annotations: readOnlyTool,
	}, func(ctx context.Context, req *mcp.CallToolRequest, in readMetricIn) (*mcp.CallToolResult, any, error) {
		c, cancel, err := t.begin(ctx, req)
		if err != nil {
			return nil, nil, err
		}
		defer cancel()

		if len(in.MetricIDs) == 0 || len(in.MetricIDs) > 5 {
			return nil, nil, errNoMetric
		}

		source := byID[in.MetricIDs[0]]
		for _, id := range in.MetricIDs {
			if byID[id] == nil {
				return nil, nil, fmt.Errorf("no metric %q — list_metrics names them", id)
			}

			if byID[id] != source {
				return nil, nil, errMixedSources
			}
		}

		group, ok := analytic_basev1.GroupType_value["GROUP_TYPE_"+strings.ToUpper(strings.TrimSpace(in.GroupBy))]
		if !ok || group == int32(analytic_basev1.GroupType_GROUP_TYPE_UNSPECIFIED) {
			return nil, nil, fmt.Errorf("group_by %q is not a group — SUMMARY, DAILY, PRODUCT, …", in.GroupBy)
		}

		team, err := c.team(in.TeamID)
		if err != nil {
			return nil, nil, err
		}

		filters := in.filters()
		groupBy := analytic_basev1.GroupType(group)

		var (
			keys    *analytic_basev1.MetricKeys
			hasNext bool
		)

		if groupBy != analytic_basev1.GroupType_GROUP_TYPE_SUMMARY {
			field, err := in.sortField(entryOf[in.MetricIDs[0]])
			if err != nil {
				return nil, nil, err
			}

			search := source.newReq(true)
			fill(search, map[string]any{
				"team_id":  team,
				"group_by": groupBy,
				"filters":  filters,
				"sort":     &analytic_basev1.MetricSort{MetricId: in.MetricIDs[0], Field: field, SortType: in.sortType()},
				"page":     &analytic_basev1.PaginationFilter{Offset: max(in.Offset, 0), Limit: in.limit()},
			})

			found, err := source.search(c.ctx, search)
			if err != nil {
				return nil, nil, rpcError(err)
			}

			keys, hasNext = keysOf(found)
		}

		data := source.newReq(false)
		fill(data, map[string]any{
			"team_id":    team,
			"group_by":   groupBy,
			"filters":    filters,
			"keys":       keys,
			"metric_ids": in.MetricIDs,
		})

		read, err := source.data(c.ctx, data)
		if err != nil {
			return nil, nil, rpcError(err)
		}

		body, err := jsonMarshaler.Marshal(read)
		if err != nil {
			return nil, nil, err
		}

		answer, err := json.Marshal(map[string]any{
			"source":   source.name,
			"group_by": strings.TrimPrefix(groupBy.String(), "GROUP_TYPE_"),
			"has_next": hasNext,
			"data":     json.RawMessage(body),
		})
		if err != nil {
			return nil, nil, err
		}

		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(answer)}}}, nil, nil
	})
}

func (in readMetricIn) filters() []*analytic_basev1.FilterItem {
	var out []*analytic_basev1.FilterItem

	if in.DateMin != "" || in.DateMax != "" {
		out = append(out, &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_DateRangeFilter{
			DateRangeFilter: &analytic_basev1.DateRangeFilter{DateMin: in.DateMin, DateMax: in.DateMax},
		}})
	}

	if in.ProductID != 0 {
		out = append(out, &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_ProductFilter{
			ProductFilter: &analytic_basev1.ProductFilter{ProductId: in.ProductID},
		}})
	}

	if in.ShopID != 0 {
		out = append(out, &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_ShopFilter{
			ShopFilter: &analytic_basev1.ShopFilter{ShopId: in.ShopID},
		}})
	}

	if in.SupplierID != 0 {
		out = append(out, &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_SupplierFilter{
			SupplierFilter: &analytic_basev1.SupplierFilter{SupplierId: in.SupplierID},
		}})
	}

	if in.WarehouseID != 0 {
		out = append(out, &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_WarehouseFilter{
			WarehouseFilter: &analytic_basev1.WarehouseFilter{WarehouseId: in.WarehouseID},
		}})
	}

	if in.UserID != 0 {
		out = append(out, &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_UserFilter{
			UserFilter: &analytic_basev1.UserFilter{UserId: in.UserID},
		}})
	}

	if in.ForTeamID != 0 {
		out = append(out, &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_TeamFilter{
			TeamFilter: &analytic_basev1.TeamFilter{TeamId: in.ForTeamID},
		}})
	}

	return out
}

func (in readMetricIn) sortField(entry metricEntry) (string, error) {
	if in.SortField != "" {
		return in.SortField, nil
	}

	for _, field := range entry.Fields {
		if field.Sortable {
			return field.Name, nil
		}
	}

	return "", errNoSortField
}

func (in readMetricIn) sortType() analytic_basev1.SortType {
	if in.Ascending {
		return analytic_basev1.SortType_SORT_TYPE_ASC
	}

	return analytic_basev1.SortType_SORT_TYPE_DESC
}

func (in readMetricIn) limit() int32 {
	switch {
	case in.Limit <= 0:
		return 20
	case in.Limit > 100:
		return 100
	default:
		return in.Limit
	}
}

// fill sets a pattern request's fields by their proto names — the same names, of the same analytic_base types, on
// every source's request. A nil value is left unset.
func fill(message proto.Message, values map[string]any) {
	reflect := message.ProtoReflect()
	fields := reflect.Descriptor().Fields()

	for name, value := range values {
		field := fields.ByName(protoreflect.Name(name))
		if field == nil {
			continue
		}

		switch v := value.(type) {
		case uint64:
			reflect.Set(field, protoreflect.ValueOfUint64(v))
		case analytic_basev1.GroupType:
			reflect.Set(field, protoreflect.ValueOfEnum(v.Number()))
		case []string:
			list := reflect.Mutable(field).List()
			for _, s := range v {
				list.Append(protoreflect.ValueOfString(s))
			}
		case []*analytic_basev1.FilterItem:
			list := reflect.Mutable(field).List()
			for _, item := range v {
				list.Append(protoreflect.ValueOfMessage(item.ProtoReflect()))
			}
		case proto.Message:
			if v == nil || !v.ProtoReflect().IsValid() {
				continue
			}

			reflect.Set(field, protoreflect.ValueOfMessage(v.ProtoReflect()))
		}
	}
}

// keysOf reads a search's keys and whether another page follows — the same two fields on every source.
func keysOf(found proto.Message) (*analytic_basev1.MetricKeys, bool) {
	reflect := found.ProtoReflect()
	fields := reflect.Descriptor().Fields()

	var keys *analytic_basev1.MetricKeys

	if field := fields.ByName("keys"); field != nil && reflect.Has(field) {
		keys, _ = reflect.Get(field).Message().Interface().(*analytic_basev1.MetricKeys)
	}

	hasNext := false
	if field := fields.ByName("has_next"); field != nil {
		hasNext = reflect.Get(field).Bool()
	}

	return keys, hasNext
}
