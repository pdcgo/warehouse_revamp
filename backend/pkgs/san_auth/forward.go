package san_auth

import (
	"context"

	"connectrpc.com/connect"
)

// ForwardBearer is a CLIENT interceptor: a call to another service carries the caller's own token — the
// bearer the access interceptor stashed in ctx (WithBearer).
//
// Forwarding the caller's token rather than a service credential means the downstream service applies
// the CALLER's permissions, not ours: no confused deputy. A request that already carries an
// Authorization header keeps it, and a ctx with no bearer sends none — the downstream then refuses the
// call, which is the right answer for a request nobody authenticated.
func ForwardBearer() connect.Interceptor {
	return forwardBearer{}
}

type forwardBearer struct{}

func (forwardBearer) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc {
	return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
		if req.Spec().IsClient {
			setBearer(ctx, req.Header().Get, req.Header().Set)
		}

		return next(ctx, req)
	}
}

func (forwardBearer) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return func(ctx context.Context, spec connect.Spec) connect.StreamingClientConn {
		conn := next(ctx, spec)
		setBearer(ctx, conn.RequestHeader().Get, conn.RequestHeader().Set)

		return conn
	}
}

func (forwardBearer) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return next
}

func setBearer(ctx context.Context, get func(string) string, set func(string, string)) {
	if get("Authorization") != "" {
		return
	}

	token := GetBearer(ctx)
	if token == "" {
		return
	}

	set("Authorization", "Bearer "+token)
}
