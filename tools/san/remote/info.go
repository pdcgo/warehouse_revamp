package remote

import (
	"context"
	"runtime"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	remotev1 "github.com/pdcgo/warehouse_revamp/backend/gen/san/remote/v1"
)

// Info is the handshake an agent makes before its first command.
//
// It answers the three things a caller cannot guess and would otherwise discover by getting them
// wrong: where the workspace is, WHICH SHELL its command will be parsed by — `&&` and `$(…)` mean
// different things to sh and PowerShell — and how long the credential it just used will last.
//
// It is also the cheapest possible token check, which is why an agent should call it at startup
// rather than finding out its token is dead halfway through a build.
func (s *Service) Info(
	ctx context.Context,
	req *connect.Request[remotev1.InfoRequest],
) (*connect.Response[remotev1.InfoResponse], error) {
	resp := &remotev1.InfoResponse{
		WorkspaceRoot:         s.root,
		Shell:                 s.Shell(),
		Os:                    runtime.GOOS,
		Arch:                  runtime.GOARCH,
		DefaultTimeoutSeconds: uint32(s.defaultTimeout.Seconds()),
		MaxTimeoutSeconds:     uint32(s.maxTimeout.Seconds()),
	}

	// Left unset when the token has no expiry — the field means "when you will be cut off", and
	// a zero timestamp would read as 1970 rather than as "not applicable".
	if !s.tokenExpiresAt.IsZero() {
		resp.TokenExpiresAt = timestamppb.New(s.tokenExpiresAt)
	}

	return connect.NewResponse(resp), nil
}
