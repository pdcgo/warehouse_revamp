package user_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
)

// UserErase implements [userv1connect.UserServiceHandler].
//
// ⚠ NOT BUILT. The RPC is part of the user prototype's contract, which waits on the owner's
// design_accept; until then it only exists so the handler interface compiles. What it will do is
// erase-keeps-the-row in docs/business/user/context_decision.md.
func (s *Service) UserErase(
	_ context.Context,
	_ *connect.Request[userv1.UserEraseRequest],
) (*connect.Response[userv1.UserEraseResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented,
		errors.New("erasing a user is not built yet"))
}
