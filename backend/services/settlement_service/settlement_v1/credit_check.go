package settlement_v1

import (
	"context"

	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// CreditBlock names the creditor that refused, and the two numbers that explain why (#189). It is
// returned rather than an error because the caller has to SHOW it: "blocked" is not actionable,
// "Warehouse Jakarta: you owe 52.000.000 of a 50.000.000 limit" is.
type CreditBlock struct {
	CreditorTeamID uint64
	// What the debtor currently owes this creditor, as a POSITIVE number. The ledger stores a payable
	// as negative; a message reading "you owe -52.000.000" is how a sign convention reaches a user.
	Debt int64
	// The limit that was hit. A limit of 0 is a real value here — it means no credit at all.
	Limit int64
}

// CheckCredit reports the FIRST creditor refusing `debtorTeamID` any more credit, or nil if every one
// of them allows the order (#189).
//
// THE RULE IS `debt < limit`, on CURRENT debt (owner, 2026-07-21). Exposure can therefore reach the
// limit plus one order's fees and the NEXT order is blocked. That is friendlier than a hard ceiling —
// a person is cut off next time rather than rejected mid-order for an amount they cannot see — and it
// agrees with the eventual-consistency window rather than fighting it: §3.3 already accepts that an
// order may commit before its fees post, so a check reading a slightly stale balance overshoots by
// about one order, which is exactly what this rule already permits.
//
// ⚠ ABSENT MEANS UNLIMITED, `0` MEANS NO CREDIT AT ALL. No terms row, or a row with a NULL limit,
// allows anything — a creditor that has configured nothing is extending unlimited credit. A stored 0
// blocks everything, including the very first order. They are opposites, which is why the limit is a
// pointer the whole way down and is never read through a zero-defaulting getter.
//
// ⚠ THIS IS A PRE-CHECK AND NEVER A GUARD INSIDE `PostEntry`. The ledger records what happened and
// must never decline to record it; the order flow chooses to gate itself. A ledger that sometimes
// refuses reality is how books stop matching the world — the fees of an order that slipped through
// still post, and the next order is the one that is stopped.
//
// EACH CREDITOR IS CHECKED INDEPENDENTLY — the fulfilling warehouse, and every team owning a product
// on the order. Any one of them over its limit rejects the whole order, and the caller is told WHICH:
// an order blocked by an unnamed creditor is one nobody can unblock.
func (s *Service) CheckCredit(
	ctx context.Context,
	debtorTeamID uint64,
	creditorTeamIDs []uint64,
) (*CreditBlock, error) {
	creditors := distinctCreditors(debtorTeamID, creditorTeamIDs)
	if len(creditors) == 0 {
		return nil, nil
	}

	limits, err := s.creditLimits(ctx, debtorTeamID, creditors)
	if err != nil {
		return nil, err
	}

	// Nobody has configured a limit, so there is nothing to check and no reason to read balances.
	if len(limits) == 0 {
		return nil, nil
	}

	debts, err := s.debtsToward(ctx, debtorTeamID, creditors)
	if err != nil {
		return nil, err
	}

	// Iterated over the SORTED creditor list rather than the map, so an order blocked by two creditors
	// names the same one every time. A message that changes between two identical attempts reads as a
	// flapping system rather than a settled debt.
	for _, creditorID := range creditors {
		limit, configured := limits[creditorID]
		if !configured {
			continue
		}

		debt := debts[creditorID]
		if debt < limit {
			continue
		}

		return &CreditBlock{
			CreditorTeamID: creditorID,
			Debt:           debt,
			Limit:          limit,
		}, nil
	}

	return nil, nil
}

// distinctCreditors drops duplicates, the zero id, and the debtor itself — a team fulfilling its own
// order, or selling its own goods, owes nobody and cannot limit itself. Sorted for a stable verdict.
func distinctCreditors(debtorTeamID uint64, ids []uint64) []uint64 {
	seen := make(map[uint64]bool, len(ids))
	out := make([]uint64, 0, len(ids))

	for _, id := range ids {
		if id == 0 || id == debtorTeamID || seen[id] {
			continue
		}

		seen[id] = true

		out = append(out, id)
	}

	sortUint64s(out)

	return out
}

// creditLimits reads each creditor's limit toward this debtor: their specific row if there is one,
// else their default row (`counterparty_id = 0`).
//
// ⚠ A CREDITOR IS ABSENT FROM THE RESULT WHEN IT HAS NO LIMIT, and that is not the same as a limit of
// zero. Both a missing terms row and a row with a NULL `credit_limit` mean unlimited, so neither is
// recorded — the caller checks presence, never the value.
func (s *Service) creditLimits(
	ctx context.Context,
	debtorTeamID uint64,
	creditorIDs []uint64,
) (map[uint64]int64, error) {
	var rows []settlement_service_models.SettlementTerms

	err := s.db.
		WithContext(ctx).
		Where("team_id IN ? AND counterparty_id IN ?", creditorIDs, []uint64{debtorTeamID, 0}).
		// The specific row LAST, so it overwrites the default as the loop below assigns. One query
		// rather than two, and the precedence is in the ordering instead of in a conditional.
		Order("counterparty_id ASC").
		Find(&rows).
		Error
	if err != nil {
		return nil, err
	}

	limits := make(map[uint64]int64, len(rows))

	for i := range rows {
		if rows[i].CreditLimit == nil {
			// An override with no limit LIFTS the default's limit for this debtor — the specific row
			// wins whether it tightens or loosens, which is what an override means.
			delete(limits, rows[i].TeamID)

			continue
		}

		limits[rows[i].TeamID] = *rows[i].CreditLimit
	}

	return limits, nil
}

// debtsToward reads what the debtor currently owes each creditor, as a POSITIVE number.
//
// The balance is read from the DEBTOR'S side, where a payable is negative, and flipped. A creditor
// the debtor is square with — or has never traded with — has no row, and reads as a debt of 0.
func (s *Service) debtsToward(
	ctx context.Context,
	debtorTeamID uint64,
	creditorIDs []uint64,
) (map[uint64]int64, error) {
	var rows []settlement_service_models.SettlementBalance

	err := s.db.
		WithContext(ctx).
		Where("team_id = ? AND counterparty_id IN ?", debtorTeamID, creditorIDs).
		Find(&rows).
		Error
	if err != nil {
		return nil, err
	}

	debts := make(map[uint64]int64, len(rows))

	for i := range rows {
		// A positive balance means the CREDITOR owes the debtor. That is not debt, and reading it as a
		// negative one would let a team that is owed money borrow past its limit.
		if rows[i].Balance >= 0 {
			continue
		}

		debts[rows[i].CounterpartyID] = -rows[i].Balance
	}

	return debts, nil
}
