package settlement_v1

import (
	"context"

	"connectrpc.com/connect"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// SettlementTermsSet writes one creditor's terms toward one debtor (#189) — an UPSERT on the pair,
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
func (s *Service) SettlementTermsSet(
	ctx context.Context,
	req *connect.Request[settlementv1.SettlementTermsSetRequest],
) (*connect.Response[settlementv1.SettlementTermsSetResponse], error) {
	teamID := req.Msg.GetTeamId()
	counterpartyID := req.Msg.GetCounterpartyId()

	// The DB has the same CHECK, but a constraint violation reaches the caller as an internal error.
	// A team configuring terms against itself made a mistake worth naming.
	if counterpartyID == teamID {
		return nil, connect.NewError(connect.CodeInvalidArgument, errSameTeam)
	}

	var row settlement_service_models.SettlementTerms

	err := s.db.
		WithContext(ctx).
		Raw(`
			INSERT INTO settlement_terms
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
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&settlementv1.SettlementTermsSetResponse{
		Terms: termsToProto(&row),
	}), nil
}
