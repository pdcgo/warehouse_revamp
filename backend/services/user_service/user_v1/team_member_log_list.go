package user_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
)

// TeamMemberLogList implements [userv1connect.UserServiceHandler].
//
// ⚠ NOT BUILT. The RPC is part of the user prototype's contract, which waits on the owner's
// design_accept; until then it only exists so the handler interface compiles. There is no log
// table yet — every-role-change-is-logged in docs/business/user/context_decision.md.
func (s *Service) TeamMemberLogList(
	_ context.Context,
	_ *connect.Request[userv1.TeamMemberLogListRequest],
) (*connect.Response[userv1.TeamMemberLogListResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented,
		errors.New("the membership log is not built yet"))
}
