package settlement_v1

import (
	"context"

	"connectrpc.com/connect"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// SettlementTermsDelete removes one pair's terms entirely (#189), which drops that debtor back to the
// creditor's DEFAULT row (`counterparty_id = 0`) — or, if there is no default either, to charging
// nothing and allowing anything.
//
// ⚠ THIS IS A REAL DELETE AND IT IS DELIBERATE. A credit limit of `0` means NO CREDIT AT ALL, so
// "stop limiting this team" cannot be expressed by zeroing the column — the two readings are exact
// opposites. Removing the row is how the absence gets back.
//
// Deleting the DEFAULT row (`counterparty_id = 0`) is allowed and is not a special case: it means the
// creditor no longer has a house rate, and every debtor without an override falls to charging nothing.
//
// ⚠ IT NEVER TOUCHES THE LEDGER. Terms decide what FUTURE postings charge; entries already posted are
// immutable facts about money that moved. A delete that also unwound past fees would be rewriting
// history to match a rate change.
//
// Deleting terms that do not exist SUCCEEDS. The caller asked for a state — "this pair has no
// override" — and that state holds either way; a retry after a timeout must not fail because the
// first attempt worked.
func (s *Service) SettlementTermsDelete(
	ctx context.Context,
	req *connect.Request[settlementv1.SettlementTermsDeleteRequest],
) (*connect.Response[settlementv1.SettlementTermsDeleteResponse], error) {
	err := s.db.
		WithContext(ctx).
		Where("team_id = ? AND counterparty_id = ?", req.Msg.GetTeamId(), req.Msg.GetCounterpartyId()).
		Delete(&settlement_service_models.SettlementTerms{}).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&settlementv1.SettlementTermsDeleteResponse{}), nil
}
