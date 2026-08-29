package liability_v1

import (
	"context"

	"connectrpc.com/connect"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
)

// LiabilityTermsHistoryList serves the change log behind the Credit Terms screen — ⚠ NOT YET
// IMPLEMENTED, deliberately.
//
// The RPC exists because the CONTRACT IS DERIVED FROM THE SCREEN and is accepted at the same gate as
// it (HARD RULE 6). The screen is a Storybook prototype awaiting `design_accept`, so this handler
// exists only to keep the compile-time proof in service.go honest: a service is mounted WHOLE, so
// the moment the proto grew an RPC every method of that interface had to exist or the build breaks.
//
// ⚠ IT REFUSES RATHER THAN RETURNING AN EMPTY PAGE. An empty list is indistinguishable from "nobody
// has ever changed a limit", which is exactly the false reassurance the log exists to prevent — an
// audit surface that quietly answers "nothing happened" is worse than one that says it cannot answer.
//
// What it needs before it can be written, and neither is this handler's decision:
//
//   - a `liability_terms_changes` table, with BOTH limit columns NULLABLE. `NULL`, `0` and a number
//     are three different acts, and an integer column flattens the first into the second — turning
//     "they removed the limit" into "they froze the team". Recorded in
//     docs/business/balance/context_decision.md#a-limit-change-is-recorded.
//   - the actor, stamped from the token at write time in `LiabilityTermsSet` / `LiabilityTermsDelete`,
//     along with whether the writer was outside the creditor team. A caller cannot be trusted to
//     report that its own write was an override.
func (s *Service) LiabilityTermsHistoryList(
	ctx context.Context,
	req *connect.Request[liabilityv1.LiabilityTermsHistoryListRequest],
) (*connect.Response[liabilityv1.LiabilityTermsHistoryListResponse], error) {
	return nil, connect.NewError(
		connect.CodeUnimplemented,
		errTermsHistoryNotBuilt,
	)
}
