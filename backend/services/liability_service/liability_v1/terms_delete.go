package liability_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

// LiabilityTermsDelete removes one pair's terms entirely (#189), which drops that debtor back to the
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
func (s *Service) LiabilityTermsDelete(
	ctx context.Context,
	req *connect.Request[liabilityv1.LiabilityTermsDeleteRequest],
) (*connect.Response[liabilityv1.LiabilityTermsDeleteResponse], error) {
	teamID := req.Msg.GetTeamId()
	counterpartyID := req.Msg.GetCounterpartyId()

	// ⚠ THE DELETE AND ITS LOG ENTRY ARE ONE TRANSACTION (a-limit-change-is-recorded). Removing a
	// pair's terms is a limit change like any other — arguably the biggest one, since it lifts a
	// ceiling entirely — and it must not be the one act that leaves no trace.
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var before liability_service_models.LiabilityTerms

		found := tx.
			Where("team_id = ? AND counterparty_id = ?", teamID, counterpartyID).
			Limit(1).
			Find(&before)
		if found.Error != nil {
			return found.Error
		}

		// ⚠ DELETING WHAT IS NOT THERE LOGS NOTHING. The RPC still succeeds — the caller asked for a
		// state and that state holds — but nothing CHANGED, and a history full of no-ops is a history
		// nobody reads. A retry after a timeout must not write a second entry either.
		if found.RowsAffected == 0 {
			return nil
		}

		delErr := tx.
			Where("team_id = ? AND counterparty_id = ?", teamID, counterpartyID).
			Delete(&liability_service_models.LiabilityTerms{}).
			Error
		if delErr != nil {
			return delErr
		}

		// `after` is nil: there are no terms now. The new limit stays NULL rather than 0, which is the
		// whole reason that column is nullable — this act REMOVED a ceiling, and recording 0 would say
		// it froze the team instead.
		return recordTermsChange(ctx, tx, teamID, counterpartyID, &before, nil, req.Msg.GetReason())
	})
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&liabilityv1.LiabilityTermsDeleteResponse{}), nil
}
