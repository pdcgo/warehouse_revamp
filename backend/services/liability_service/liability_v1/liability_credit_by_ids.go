package liability_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
)

// LiabilityCreditByIds is the DEBTOR's side of a limit (the-debtor-sees-the-limits-set-on-it): for each creditor
// asked about, the limit it set on the asking team, the debt the asking team already carries, and how close it
// stands.
//
// ⚠ IT READS THROUGH `CheckCredit`'S OWN HELPERS — `creditLimits` for the precedence (the pair row, else the
// creditor's default, else unlimited) and `debtsToward` for the committed balance — and states AT_LIMIT on
// `refusesCredit`, the comparison the create blocks on. The order form and the order create can therefore never
// disagree about a figure, which is the whole reason the read exists.
//
// ⚠ THE SCOPE IS THE DEBTOR, AND IT IS ALSO THE FILTER. Both helpers read only rows whose debtor is `team_id`
// (`counterparty_id IN (team_id, 0)` on the terms, `team_id = team_id` on the balances), so naming a creditor
// returns the limit that creditor set on THIS team and nothing about any other team it limits.
//
// TWO QUERIES AT MOST, whatever the number of creditors: one for the terms rows, one for the balances. A GENERAL
// slice adds one call to team_service for the names, and only when it is asked for.
func (s *Service) LiabilityCreditByIds(
	ctx context.Context,
	req *connect.Request[liabilityv1.LiabilityCreditByIdsRequest],
) (*connect.Response[liabilityv1.LiabilityCreditByIdsResponse], error) {
	debtorTeamID := req.Msg.GetTeamId()

	// The same cut the check makes: duplicates, 0 and the asking team itself are dropped — a team cannot owe
	// itself, and asking about it has nothing to answer.
	creditors := distinctCreditors(debtorTeamID, req.Msg.GetFilter().GetIds())

	items := make(map[uint64]*liabilityv1.LiabilityCreditByIdsResponseList, len(creditors))
	if len(creditors) == 0 {
		return connect.NewResponse(&liabilityv1.LiabilityCreditByIdsResponse{Items: items}), nil
	}

	types := req.Msg.GetDataRequest()
	if len(types) == 0 {
		types = []liabilityv1.LiabilityCreditByIdsDataType{
			liabilityv1.LiabilityCreditByIdsDataType_LIABILITY_CREDIT_BY_IDS_DATA_TYPE_CREDIT,
		}
	}

	var credits map[uint64]*liabilityv1.LiabilityCredit

	var names map[uint64]string

	for _, t := range types {
		switch t {
		case liabilityv1.LiabilityCreditByIdsDataType_LIABILITY_CREDIT_BY_IDS_DATA_TYPE_CREDIT:
			if credits != nil {
				continue
			}

			read, err := s.creditStandings(ctx, debtorTeamID, creditors)
			if err != nil {
				return nil, dbError(err)
			}

			credits = read
		case liabilityv1.LiabilityCreditByIdsDataType_LIABILITY_CREDIT_BY_IDS_DATA_TYPE_GENERAL:
			if names != nil {
				continue
			}

			read, err := s.names.TeamNames(ctx, creditors)
			if err != nil {
				// team_service's own refusal reaches the caller with its own code, as checkAccount does.
				var connectErr *connect.Error
				if errors.As(err, &connectErr) {
					return nil, connectErr
				}

				return nil, connect.NewError(connect.CodeUnavailable, err)
			}

			names = read
		}
	}

	for _, creditorID := range creditors {
		slices := make([]*liabilityv1.LiabilityCreditByIdsResponseItem, 0, len(types))

		for _, t := range types {
			switch t {
			case liabilityv1.LiabilityCreditByIdsDataType_LIABILITY_CREDIT_BY_IDS_DATA_TYPE_GENERAL:
				slices = append(slices, &liabilityv1.LiabilityCreditByIdsResponseItem{
					D: &liabilityv1.LiabilityCreditByIdsResponseItem_General{General: &commonv1.GeneralMapItem{
						MapData: map[uint64]*commonv1.GeneralItem{
							creditorID: {Id: creditorID, Name: names[creditorID]},
						},
					}},
				})
			case liabilityv1.LiabilityCreditByIdsDataType_LIABILITY_CREDIT_BY_IDS_DATA_TYPE_CREDIT:
				slices = append(slices, &liabilityv1.LiabilityCreditByIdsResponseItem{
					D: &liabilityv1.LiabilityCreditByIdsResponseItem_Credit{Credit: &liabilityv1.LiabilityCreditMapItem{
						MapData: map[uint64]*liabilityv1.LiabilityCredit{creditorID: credits[creditorID]},
					}},
				})
			}
		}

		items[creditorID] = &liabilityv1.LiabilityCreditByIdsResponseList{Items: slices}
	}

	return connect.NewResponse(&liabilityv1.LiabilityCreditByIdsResponse{Items: items}), nil
}

// creditStandings reads every creditor's limit and the debt toward it — one query each, never one per creditor.
//
// ⚠ EVERY CREDITOR GETS AN ITEM, limited or not. Unlike CheckCredit, which may skip the balances when nobody set a
// limit, this always reads them: an unlimited creditor's debt is still a figure the debtor is shown.
func (s *Service) creditStandings(
	ctx context.Context,
	debtorTeamID uint64,
	creditors []uint64,
) (map[uint64]*liabilityv1.LiabilityCredit, error) {
	limits, err := s.creditLimits(ctx, debtorTeamID, creditors)
	if err != nil {
		return nil, err
	}

	debts, err := s.debtsToward(ctx, debtorTeamID, creditors)
	if err != nil {
		return nil, err
	}

	out := make(map[uint64]*liabilityv1.LiabilityCredit, len(creditors))

	for _, creditorID := range creditors {
		credit := &liabilityv1.LiabilityCredit{
			CreditorTeamId: creditorID,
			Debt:           debts[creditorID],
			State:          liabilityv1.LiabilityCreditState_LIABILITY_CREDIT_STATE_OK,
		}

		// ⚠ PRESENCE, NEVER THE VALUE: absent is unlimited and a stored 0 is no credit at all. Copied into a fresh
		// variable so each item points at its own limit, not at the loop's.
		limit, capped := limits[creditorID]
		if capped {
			credit.CreditLimit = &limit
			credit.State = creditState(credit.Debt, limit)
		}

		out[creditorID] = credit
	}

	return out, nil
}

// creditState places a debt against a real limit (the-threshold-warns-at-eighty-percent).
//
// The thresholds are the screen's own, `features/liability/CreditMeter` `creditWarning`: NEAR from 80% —
// `debt × 5 ≥ limit × 4` is exactly `debt ≥ 0.8 × limit` in integers — and AT_LIMIT on `refusesCredit`. A limit of 0
// is therefore always AT_LIMIT: no credit at all refuses the next order whatever is owed, and the meter says so in
// words ("Frozen") rather than as a percentage.
func creditState(debt, limit int64) liabilityv1.LiabilityCreditState {
	if refusesCredit(debt, limit) {
		return liabilityv1.LiabilityCreditState_LIABILITY_CREDIT_STATE_AT_LIMIT
	}

	if debt*5 >= limit*4 {
		return liabilityv1.LiabilityCreditState_LIABILITY_CREDIT_STATE_NEAR
	}

	return liabilityv1.LiabilityCreditState_LIABILITY_CREDIT_STATE_OK
}
