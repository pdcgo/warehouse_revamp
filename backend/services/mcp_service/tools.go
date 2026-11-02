package mcp_service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"connectrpc.com/connect"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"golang.org/x/time/rate"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
)

// tools holds what every tool shares: the clients, and the per-connection rate limit.
type tools struct {
	clients Clients
	limits  *limits
}

var (
	errNoGrant    = errors.New("this call carries no agent credential")
	errNameATeam  = errors.New("this connection reads every team — name the team_id; list_teams gives the ids")
	errSlowDown   = fmt.Errorf("too many calls — a connection may make %d a minute; wait and try again", callsPerMinute)
	readOnlyTool  = &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: boolPtr(false)}
	jsonMarshaler = protojson.MarshalOptions{UseProtoNames: true}
)

// call is one tool call's agent: its grant, and a ctx that forwards its bearer to our RPCs.
type call struct {
	grant *access_interceptors.AgentGrant
	ctx   context.Context
}

// begin reads the agent off the request, checks its rate, and bounds the call's reads.
func (t *tools) begin(ctx context.Context, req *mcp.CallToolRequest) (*call, context.CancelFunc, error) {
	if req.Extra == nil || req.Extra.TokenInfo == nil {
		return nil, nil, errNoGrant
	}

	grant, _ := req.Extra.TokenInfo.Extra[grantKey].(*access_interceptors.AgentGrant)
	bearer, _ := req.Extra.TokenInfo.Extra[bearerKey].(string)

	if grant == nil || bearer == "" {
		return nil, nil, errNoGrant
	}

	if !t.limits.allow(grant.CredentialID) {
		return nil, nil, errSlowDown
	}

	ctx, cancel := context.WithTimeout(ctx, callTimeout)

	return &call{grant: grant, ctx: san_auth.WithBearer(ctx, bearer)}, cancel, nil
}

// team is the team a tool reads: the one asked for, or the connection's own. A connection to every team must name one.
// A one-team connection naming another is not refused here — the access interceptor refuses it, as it would any call.
func (c *call) team(asked uint64) (uint64, error) {
	if asked != 0 {
		return asked, nil
	}

	if c.grant.TeamID == 0 {
		return 0, errNameATeam
	}

	return c.grant.TeamID, nil
}

// asText is a tool's answer as JSON text — the RPC's response as the screen reads it, field names as in the contract.
func asText(message proto.Message) (*mcp.CallToolResult, any, error) {
	body, err := jsonMarshaler.Marshal(message)
	if err != nil {
		return nil, nil, err
	}

	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(body)}}}, nil, nil
}

// rpcError turns an RPC's refusal into words for the agent — what the person would read on the screen.
func rpcError(err error) error {
	var connectErr *connect.Error
	if errors.As(err, &connectErr) {
		return fmt.Errorf("%s: %s", connectErr.Code(), connectErr.Message())
	}

	return err
}

// ── the rate limit (the-agent-reads-through-the-metric-pattern: "a rate limit per credential") ───────────────────────

const (
	// callsPerMinute is one connection's sustained rate, and burst what it may spend at once — enough for an agent
	// working through a report, too little to scrape the business.
	callsPerMinute = 120
	burst          = 20
)

type limits struct {
	mu   sync.Mutex
	byID map[uint64]*rate.Limiter
}

func newLimits() *limits {
	return &limits{byID: map[uint64]*rate.Limiter{}}
}

// allow spends one call of the connection's budget. Per instance: behind several, a connection's budget is several —
// a bound on a runaway agent, not an accounting.
func (l *limits) allow(credentialID uint64) bool {
	l.mu.Lock()
	limiter, ok := l.byID[credentialID]

	if !ok {
		limiter = rate.NewLimiter(rate.Every(time.Minute/callsPerMinute), burst)
		l.byID[credentialID] = limiter
	}
	l.mu.Unlock()

	return limiter.Allow()
}

func boolPtr(b bool) *bool {
	return &b
}
