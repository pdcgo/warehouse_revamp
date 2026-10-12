package liability_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

// LiabilityTermsSet writes one creditor's terms toward one debtor (#189) — an UPSERT on the pair,
// because "set the rate" is one act whether or not a row already exists. Making the caller know which
// it is would mean a create that fails on a second edit, or an update that fails on the first.
//
// `counterparty_id = 0` writes the DEFAULT row: the rate applying to every team without one of their
// own. That is the entire override mechanism (see the migration), and it is why 0 is not a valid team
// id anywhere else in this system.
//
// ⚠ AN OMITTED `credit_limit` MEANS UNLIMITED; `0` MEANS NO CREDIT AT ALL. They are opposites, so the
// handler must distinguish "absent" from "zero" and cannot use the getter — `GetCreditLimit()` flattens
// both to 0, which would silently grant infinite credit to a team somebody just froze. The pointer is
// read directly, and it is passed to SQL as a real NULL.
//
// The write is one statement rather than a read-then-write: two managers editing the same pair at the
// same second would otherwise both see "no row", both insert, and one would fail on the unique index.
// ON CONFLICT makes the second one an update, which is what either of them meant.
func (s *Service) LiabilityTermsSet(
	ctx context.Context,
	req *connect.Request[liabilityv1.LiabilityTermsSetRequest],
) (*connect.Response[liabilityv1.LiabilityTermsSetResponse], error) {
	teamID := req.Msg.GetTeamId()
	counterpartyID := req.Msg.GetCounterpartyId()

	// The DB has the same CHECK, but a constraint violation reaches the caller as an internal error.
	// A team configuring terms against itself made a mistake worth naming.
	if counterpartyID == teamID {
		return nil, connect.NewError(connect.CodeInvalidArgument, errSameTeam)
	}

	var row liability_service_models.LiabilityTerms

	// ⚠ THE UPSERT AND ITS LOG ENTRY ARE ONE TRANSACTION (a-limit-change-is-recorded). A limit that
	// changed with no record of who changed it is the back door that decision exists to close — and it
	// is worse than either half failing, because nobody would know to look.
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// WHAT IT WAS, read inside the transaction and BEFORE the write. Nil when this pair has never
		// had terms, which the log renders as "nothing set" — because that is what it was.
		var before *liability_service_models.LiabilityTerms

		var existing liability_service_models.LiabilityTerms

		found := tx.
			Where("team_id = ? AND counterparty_id = ?", teamID, counterpartyID).
			Limit(1).
			Find(&existing)
		if found.Error != nil {
			return found.Error
		}

		if found.RowsAffected > 0 {
			before = &existing
		}

		upsertErr := tx.
			Raw(`
				INSERT INTO liability_terms
			    (team_id, counterparty_id, handling_fee, product_markup_bp, credit_limit,
			     created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, NOW(), NOW())
			ON CONFLICT (team_id, counterparty_id) DO UPDATE SET
			    handling_fee      = EXCLUDED.handling_fee,
			    product_markup_bp = EXCLUDED.product_markup_bp,
			    -- Written unconditionally, NULL included: omitting the field is how a caller says
			    -- "unlimited", so COALESCE-ing to the stored value would make a limit impossible to
			    -- lift without deleting the fees too.
			    credit_limit      = EXCLUDED.credit_limit,
			    updated_at        = NOW()
			RETURNING id, team_id, counterparty_id, handling_fee, product_markup_bp, credit_limit,
			          created_at, updated_at`,
				teamID,
				counterpartyID,
				req.Msg.GetHandlingFee(),
				req.Msg.GetProductMarkupBp(),
				// NOT GetCreditLimit() — see the note above. nil must reach SQL as NULL.
				req.Msg.CreditLimit,
			).
			Scan(&row).
			Error
		if upsertErr != nil {
			return upsertErr
		}

		return recordTermsChange(ctx, tx, teamID, counterpartyID, before, &row, req.Msg.GetReason())
	})
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&liabilityv1.LiabilityTermsSetResponse{
		Terms: termsToProto(&row),
	}), nil
}
