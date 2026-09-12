package team_service

import (
	"net/http"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1/teamv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	team_v1 "github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
)

// NewRegister mounts team_service's Connect handler under the shared interceptor chain and reports
// it for reflection.
func NewRegister(
	mux *http.ServeMux,
	team *team_v1.Service,
	opts connect.HandlerOption,
) san_grpc.RegisterHandler {
	return func() san_grpc.ServiceReflectNames {
		mux.Handle(teamv1connect.NewTeamServiceHandler(team, opts))

		return san_grpc.ServiceReflectNames{teamv1connect.TeamServiceName}
	}
}
