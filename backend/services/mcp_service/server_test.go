package mcp_service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1/liabilityv1connect"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
)

// THE WHOLE PATH, short of a database: the SDK's own client → /mcp → the bearer check → a tool → a Connect call carrying
// the agent's bearer → the REAL access interceptor → a stub handler. So "a tool cannot do what the credential cannot"
// is asserted, not assumed.

const (
	oneTeam   = access_interceptors.AgentTokenPrefix + "one-team"
	everyTeam = access_interceptors.AgentTokenPrefix + "every-team"
	person    = uint64(7)
	team      = uint64(5)
	other     = uint64(6)
)

type agentsStub map[string]*access_interceptors.AgentGrant

func (a agentsStub) VerifyAgent(_ context.Context, token string) (*access_interceptors.AgentGrant, error) {
	grant, ok := a[token]
	if !ok {
		return nil, access_interceptors.ErrInvalidAgentCredential
	}

	return grant, nil
}

// owner holds SELLING_OWNER in teams 5 and 6, and ROOT in the root team when root is set.
type owner struct{ root bool }

func (o owner) Resolve(_ context.Context, _ uint64, teamID uint64) (access_interceptors.Access, error) {
	access := access_interceptors.Access{}
	if teamID == team || teamID == other {
		access.Role = role_basev1.Role_ROLE_SELLING_OWNER
	}

	if o.root {
		access.RootRole = role_basev1.Role_ROLE_ROOT
	}

	return access, nil
}

func (owner) Invalidate(context.Context, uint64) error { return nil }

// recorded is what the stub RPCs were asked, in order.
type recorded struct {
	mu    sync.Mutex
	calls []string
	teams []uint64
	last  map[string]any
}

func (r *recorded) add(name string, teamID uint64, detail any) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.calls = append(r.calls, name)
	r.teams = append(r.teams, teamID)

	if r.last == nil {
		r.last = map[string]any{}
	}

	r.last[name] = detail
}

type analytics struct {
	sellingv1connect.UnimplementedOrderAnalyticServiceHandler
	rec *recorded
}

func (a analytics) MetricSearch(_ context.Context, req *connect.Request[sellingv1.MetricSearchRequest]) (*connect.Response[sellingv1.MetricSearchResponse], error) {
	a.rec.add("MetricSearch", req.Msg.GetTeamId(), req.Msg)

	return connect.NewResponse(&sellingv1.MetricSearchResponse{
		Keys:    &analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: []string{"2026-10-01", "2026-10-02"}}}},
		HasNext: true,
	}), nil
}

func (a analytics) MetricData(_ context.Context, req *connect.Request[sellingv1.MetricDataRequest]) (*connect.Response[sellingv1.MetricDataResponse], error) {
	a.rec.add("MetricData", req.Msg.GetTeamId(), req.Msg)

	return connect.NewResponse(&sellingv1.MetricDataResponse{AsOfUnix: 1_790_000_000}), nil
}

type balances struct {
	liabilityv1connect.UnimplementedLiabilityServiceHandler
	rec *recorded
}

func (b balances) LiabilityPositionList(_ context.Context, req *connect.Request[liabilityv1.LiabilityPositionListRequest]) (*connect.Response[liabilityv1.LiabilityPositionListResponse], error) {
	b.rec.add("LiabilityPositionList", req.Msg.GetTeamId(), req.Msg)

	return connect.NewResponse(&liabilityv1.LiabilityPositionListResponse{TotalReceivable: 700_000}), nil
}

type orders struct {
	sellingv1connect.UnimplementedOrderServiceHandler
	rec *recorded
}

func (o orders) OrderByExternalRefs(_ context.Context, req *connect.Request[sellingv1.OrderByExternalRefsRequest]) (*connect.Response[sellingv1.OrderByExternalRefsResponse], error) {
	o.rec.add("OrderByExternalRefs", req.Msg.GetTeamId(), req.Msg)

	return connect.NewResponse(&sellingv1.OrderByExternalRefsResponse{Items: map[string]*sellingv1.OrderByExternalRefsResponseList{
		"SHP-1": {Items: []*sellingv1.OrderByExternalRefsResponseItem{{D: &sellingv1.OrderByExternalRefsResponseItem_OrderRef{
			OrderRef: &sellingv1.OrderRefMapItem{MapData: map[uint64]*sellingv1.OrderRefItem{41: {OrderId: 41}}},
		}}}},
	}}), nil
}

func (o orders) OrderDetail(_ context.Context, req *connect.Request[sellingv1.OrderDetailRequest]) (*connect.Response[sellingv1.OrderDetailResponse], error) {
	o.rec.add("OrderDetail", req.Msg.GetTeamId(), req.Msg)

	return connect.NewResponse(&sellingv1.OrderDetailResponse{Order: &sellingv1.Order{Id: req.Msg.GetOrderId(), CustomerName: "Budi"}}), nil
}

// bearerTransport is how an agent sends its credential on every request.
type bearerTransport struct{ token string }

func (b bearerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.token)

	return http.DefaultTransport.RoundTrip(r)
}

func start(t *testing.T, resolver access_interceptors.RoleResolver) (string, *recorded) {
	t.Helper()

	rec := &recorded{}
	agents := agentsStub{
		oneTeam:   {CredentialID: 1, UserID: person, TeamID: team, ExpiresAt: time.Now().Add(time.Hour)},
		everyTeam: {CredentialID: 2, UserID: person, TeamID: 0, ExpiresAt: time.Now().Add(time.Hour)},
	}

	guard := connect.WithInterceptors(access_interceptors.NewInterceptor(
		san_auth.NewSigner("test", 0), resolver, access_interceptors.WithAgentVerifier(agents)))

	mux := http.NewServeMux()
	mux.Handle(sellingv1connect.NewOrderAnalyticServiceHandler(analytics{rec: rec}, guard))
	mux.Handle(liabilityv1connect.NewLiabilityServiceHandler(balances{rec: rec}, guard))
	mux.Handle(sellingv1connect.NewOrderServiceHandler(orders{rec: rec}, guard))

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	mux.Handle(Path, NewHandler(agents, NewClients(server.Client(), server.URL), Config{
		PublicURL:           server.URL,
		ResourceMetadataURL: server.URL + "/.well-known/oauth-protected-resource/mcp",
	}))

	return server.URL, rec
}

func session(t *testing.T, base, token string) *mcp.ClientSession {
	t.Helper()

	client := mcp.NewClient(&mcp.Implementation{Name: "test-agent", Version: "1"}, nil)

	s, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{
		Endpoint:   base + Path,
		HTTPClient: &http.Client{Transport: bearerTransport{token: token}},
		MaxRetries: -1,
	}, nil)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}

	t.Cleanup(func() { _ = s.Close() })

	return s
}

func callTool(t *testing.T, s *mcp.ClientSession, name string, args map[string]any) (string, bool) {
	t.Helper()

	res, err := s.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatalf("call %s: %v", name, err)
	}

	var text strings.Builder
	for _, c := range res.Content {
		if tc, ok := c.(*mcp.TextContent); ok {
			text.WriteString(tc.Text)
		}
	}

	return text.String(), res.IsError
}

// No bearer: a 401 pointing the agent at the metadata its OAuth starts from.
func TestMCP_NoBearerIsSentToOAuth(t *testing.T) {
	base, _ := start(t, owner{})

	res, err := http.Post(base+Path, "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusUnauthorized || !strings.Contains(res.Header.Get("WWW-Authenticate"), "resource_metadata=") {
		t.Fatalf("no bearer = %d, WWW-Authenticate %q — want 401 naming the resource metadata", res.StatusCode, res.Header.Get("WWW-Authenticate"))
	}
}

// Every tool is a READ, and says so (an-agent-only-reads-for-now).
func TestMCP_EveryToolIsReadOnly(t *testing.T) {
	base, _ := start(t, owner{})
	s := session(t, base, oneTeam)

	listed, err := s.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("list tools: %v", err)
	}

	want := map[string]bool{"list_teams": true, "list_metrics": true, "read_metric": true, "search_products": true, "find_orders": true, "balance_positions": true}

	if len(listed.Tools) != len(want) {
		t.Fatalf("%d tools, want %d", len(listed.Tools), len(want))
	}

	for _, tool := range listed.Tools {
		if !want[tool.Name] {
			t.Fatalf("an unexpected tool %q", tool.Name)
		}

		if tool.Annotations == nil || !tool.Annotations.ReadOnlyHint {
			t.Fatalf("tool %s is not marked read-only", tool.Name)
		}
	}
}

// The metrics describe themselves — a new metric reaches the agent with no new tool.
func TestMCP_ListMetricsReadsTheCatalogue(t *testing.T) {
	base, _ := start(t, owner{})
	text, isError := callTool(t, session(t, base, oneTeam), "list_metrics", nil)

	if isError {
		t.Fatalf("list_metrics failed: %s", text)
	}

	var body struct {
		Metrics []metricEntry `json:"metrics"`
	}

	_ = json.Unmarshal([]byte(text), &body)

	sources := map[string]bool{}
	created := false

	for _, m := range body.Metrics {
		sources[m.Source] = true

		if m.ID == "metrics/orders/created" {
			created = len(m.Fields) > 0 && len(m.GroupBy) > 0
		}
	}

	if !created || !sources["orders"] || !sources["settlement"] || !sources["supplier"] {
		t.Fatalf("catalogue = %s, want every source and metrics/orders/created with its fields", text)
	}
}

// A headline read is ONE MetricData on the connection's own team; a grouped read searches first and reads its keys.
func TestMCP_ReadMetric(t *testing.T) {
	base, rec := start(t, owner{})
	s := session(t, base, oneTeam)

	text, isError := callTool(t, s, "read_metric", map[string]any{
		"metric_ids": []string{"metrics/orders/created"},
		"group_by":   "summary",
		"date_min":   "2026-10-01",
		"date_max":   "2026-10-31",
	})
	if isError {
		t.Fatalf("summary read failed: %s", text)
	}

	if len(rec.calls) != 1 || rec.calls[0] != "MetricData" || rec.teams[0] != team {
		t.Fatalf("a summary called %v on %v, want one MetricData on team %d", rec.calls, rec.teams, team)
	}

	data := rec.last["MetricData"].(*sellingv1.MetricDataRequest)
	if data.GetGroupBy() != analytic_basev1.GroupType_GROUP_TYPE_SUMMARY || data.GetFilters()[0].GetDateRangeFilter().GetDateMax() != "2026-10-31" {
		t.Fatalf("the read asked %v, want SUMMARY over the range", data)
	}

	text, isError = callTool(t, s, "read_metric", map[string]any{
		"metric_ids": []string{"metrics/orders/created"},
		"group_by":   "DAILY",
		"date_min":   "2026-10-01",
		"date_max":   "2026-10-31",
	})
	if isError {
		t.Fatalf("daily read failed: %s", text)
	}

	if rec.calls[1] != "MetricSearch" || rec.calls[2] != "MetricData" {
		t.Fatalf("a grouped read called %v, want MetricSearch then MetricData", rec.calls)
	}

	if days := rec.last["MetricData"].(*sellingv1.MetricDataRequest).GetKeys().GetDays().GetDays(); len(days) != 2 {
		t.Fatalf("the data read carried keys %v, want the search's two days", days)
	}

	if !strings.Contains(text, `"has_next":true`) {
		t.Fatalf("the answer %s does not say another page follows", text)
	}
}

// A one-team connection naming ANOTHER team is refused by the interceptor, through the tool — the person owns both.
func TestMCP_AnotherTeamIsRefusedThroughTheTool(t *testing.T) {
	base, rec := start(t, owner{})
	s := session(t, base, oneTeam)

	text, isError := callTool(t, s, "balance_positions", map[string]any{"team_id": other})
	if !isError || !strings.Contains(text, "permission_denied") {
		t.Fatalf("another team's balance = %q (error %v), want permission_denied", text, isError)
	}

	if len(rec.calls) != 0 {
		t.Fatalf("the handler ran: %v", rec.calls)
	}

	text, isError = callTool(t, s, "balance_positions", nil)
	if isError || len(rec.calls) != 1 || rec.teams[0] != team {
		t.Fatalf("its own team's balance = %q on %v, want team %d's", text, rec.teams, team)
	}

	// Money reaches the agent as a JSON NUMBER since liability 00014 (every-ledger-moves-to-double-rounded-when-frozen)
	// — never the quoted string protojson writes for an int64, which an agent would have to parse back into a figure.
	if !strings.Contains(text, `"total_receivable":700000`) {
		t.Fatalf("its own team's balance = %s, want total_receivable as the number 700000", text)
	}
}

// A connection to EVERY team must name one — and reads it while its person holds root's bypass.
func TestMCP_AnEveryTeamConnectionNamesItsTeam(t *testing.T) {
	base, rec := start(t, owner{root: true})
	s := session(t, base, everyTeam)

	text, isError := callTool(t, s, "balance_positions", nil)
	if !isError || !strings.Contains(text, "team_id") {
		t.Fatalf("no team named = %q, want an error asking for team_id", text)
	}

	_, isError = callTool(t, s, "balance_positions", map[string]any{"team_id": other})
	if isError || rec.teams[0] != other {
		t.Fatalf("root's agent reading team %d = %v on %v", other, isError, rec.teams)
	}
}

// An order reaches the agent WHOLE — the buyer included (buyer-data-reaches-the-agent); a ref nothing carries is said.
func TestMCP_FindOrders(t *testing.T) {
	base, rec := start(t, owner{})
	text, isError := callTool(t, session(t, base, oneTeam), "find_orders", map[string]any{"refs": []string{"SHP-1", "SHP-404"}})

	if isError {
		t.Fatalf("find_orders failed: %s", text)
	}

	if !strings.Contains(text, "Budi") || !strings.Contains(text, "SHP-404") {
		t.Fatalf("answer %s — want the order whole and SHP-404 not found", text)
	}

	if strings.Join(rec.calls, ",") != "OrderByExternalRefs,OrderDetail" {
		t.Fatalf("called %v, want the lookup then the order", rec.calls)
	}
}

// A revoked credential is a 401, at once.
func TestMCP_ARevokedCredentialIsUnauthorized(t *testing.T) {
	base, _ := start(t, owner{})

	client := mcp.NewClient(&mcp.Implementation{Name: "test-agent", Version: "1"}, nil)

	_, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{
		Endpoint:   base + Path,
		HTTPClient: &http.Client{Transport: bearerTransport{token: access_interceptors.AgentTokenPrefix + "revoked"}},
		MaxRetries: -1,
	}, nil)
	if err == nil {
		t.Fatal("a revoked credential connected")
	}
}

// The rate limit spends a connection's burst, then refuses — per connection, never shared.
func TestMCP_TheRateLimitIsPerConnection(t *testing.T) {
	l := newLimits()

	for range burst {
		if !l.allow(1) {
			t.Fatal("refused inside the burst")
		}
	}

	if l.allow(1) {
		t.Fatal("allowed past the burst")
	}

	if !l.allow(2) {
		t.Fatal("another connection was refused — the budget is per connection")
	}
}
