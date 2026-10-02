package san_auth_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// echoTeams records the Authorization header each call arrived with.
type echoTeams struct {
	teamv1connect.UnimplementedTeamServiceHandler

	seen []string
}

func (e *echoTeams) TeamList(
	_ context.Context,
	req *connect.Request[teamv1.TeamListRequest],
) (*connect.Response[teamv1.TeamListResponse], error) {
	e.seen = append(e.seen, req.Header().Get("Authorization"))

	return connect.NewResponse(&teamv1.TeamListResponse{}), nil
}

// A call to another service carries the CALLER's token — the one in ctx — and a header the caller set
// itself is kept; no token in ctx sends none.
func TestForwardBearerSendsTheCallersToken(t *testing.T) {
	echo := &echoTeams{}

	mux := http.NewServeMux()
	mux.Handle(teamv1connect.NewTeamServiceHandler(echo))

	server := httptest.NewServer(mux)
	defer server.Close()

	client := teamv1connect.NewTeamServiceClient(server.Client(), server.URL,
		connect.WithInterceptors(san_auth.ForwardBearer()))

	withToken := san_auth.WithBearer(context.Background(), "caller-token")

	_, err := client.TeamList(withToken, connect.NewRequest(&teamv1.TeamListRequest{}))
	if err != nil {
		t.Fatalf("forwarded call: %v", err)
	}

	own := connect.NewRequest(&teamv1.TeamListRequest{})
	own.Header().Set("Authorization", "Bearer set-by-the-caller")

	_, err = client.TeamList(withToken, own)
	if err != nil {
		t.Fatalf("call with its own header: %v", err)
	}

	_, err = client.TeamList(context.Background(), connect.NewRequest(&teamv1.TeamListRequest{}))
	if err != nil {
		t.Fatalf("call with no token: %v", err)
	}

	want := []string{"Bearer caller-token", "Bearer set-by-the-caller", ""}
	for i := range want {
		if echo.seen[i] != want[i] {
			t.Errorf("call %d carried %q, want %q", i, echo.seen[i], want[i])
		}
	}
}
