package liability_v1

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"

	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

// LiabilityPositionList returns one row per counterparty for the scoped team (#185) — BOTH
// DIRECTIONS in one list, because a counterparty is one relationship and splitting "what they owe
// me" from "what I owe them" would make a manager visit two screens to answer one question.
//
// ⚠ THE SCOPE IS `team_id` AND ONLY `team_id`. The `counterparty_id` field below is a FILTER: it
// narrows what comes back and authorizes nothing. Treating a caller-supplied counterparty as a scope
// is the easiest authorization mistake available in this service — it would let anybody holding a
// role in any team read any pair by naming it.
func (s *Service) LiabilityPositionList(
	ctx context.Context,
	req *connect.Request[liabilityv1.LiabilityPositionListRequest],
) (*connect.Response[liabilityv1.LiabilityPositionListResponse], error) {
	teamID := req.Msg.GetTeamId()
	page := req.Msg.GetPage()

	// ⚠ THE FILTER IS A FUNCTION, CALLED THREE TIMES, rather than one `*gorm.DB` passed around. GORM's
	// chain methods MUTATE the shared Statement, so a query handed on after `.Order(…)` carries that
	// ordering — and an aggregate then fails on Postgres because the ordered column is not grouped.
	// `Session` does not save you: it changes how later calls clone, not the statement already shared.
	//
	// Rebuilding from one function is what keeps the count, the rows and the summary talking about the
	// same set. A second hand-written WHERE would be a second definition, and they would disagree the
	// first time somebody edited one.
	scope := func() *gorm.DB {
		q := s.db.
			WithContext(ctx).
			Model(&liability_service_models.LiabilityBalance{}).
			Where("team_id = ?", teamID)

		if counterparty := req.Msg.GetFilter().GetCounterpartyId(); counterparty != 0 {
			q = q.Where("counterparty_id = ?", counterparty)
		}

		// A settled pair keeps its row forever — the ledger never deletes anything — so the default view
		// would otherwise fill with zeros and bury the rows a manager opened the screen for.
		if req.Msg.GetFilter().GetUnsettledOnly() {
			// Within the tolerance: a balance of exact fractions that squared can hold float dust.
			q = q.Where("abs(balance) >= " + san_money.ZeroBelow)
		}

		return q
	}

	// THE NARROWING FILTERS — the search, the kind and "awaiting only" — applied BEFORE THE PAGE (backlog #34). They
	// were the screen's, over the 20 rows it had loaded, so a counterparty on page 2 was "not found". They narrow the
	// rows and the count; the summary below keeps `scope`, because the summary is ALL balance and a search box is not
	// a scope (the-summary-is-tiles-on-the-list).
	rows, err := s.positionRows(ctx, teamID, req.Msg.GetFilter(), scope)
	if err != nil {
		return nil, err
	}

	query := rows()

	var total int64

	err = query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var balances []liability_service_models.LiabilityBalance

	offset := int((page.GetPage() - 1) * page.GetLimit())

	// Ordered by AGE, oldest debt first — the screen exists so somebody can chase the old ones, and
	// making them scroll for that would be answering a different question. NULLS LAST puts settled
	// pairs after every outstanding one; `id` breaks ties so paging is stable.
	err = query.
		Order(positionOrderClause(req.Msg.GetSort())).
		Offset(offset).
		Limit(int(page.GetLimit())).
		Find(&balances).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	waiting, err := s.awaitingConfirmation(ctx, teamID)
	if err != nil {
		return nil, dbError(err)
	}

	// SUMMARIZE ALL BALANCE — over the whole filtered set, never over `balances`, which is one page.
	// It reuses the same filters the rows came from, so the tiles and the rows cannot disagree about
	// which pairs are being talked about.
	requests, err := s.openPaymentRequests(ctx, teamID)
	if err != nil {
		return nil, dbError(err)
	}

	summary, err := summarizePositions(scope)
	if err != nil {
		return nil, dbError(err)
	}

	positions := make([]*liabilityv1.LiabilityPosition, 0, len(balances))

	var totalWaiting uint32

	for i := range balances {
		row := &liabilityv1.LiabilityPosition{
			CounterpartyId:       balances[i].CounterpartyID,
			Balance:              balances[i].Balance,
			AwaitingConfirmation: waiting[balances[i].CounterpartyID],
			PaymentRequest:       requests[balances[i].CounterpartyID],
		}

		if balances[i].OldestUnsettledAt != nil {
			row.OldestUnsettledAtUnix = balances[i].OldestUnsettledAt.Unix()
		}

		positions = append(positions, row)
	}

	// The nav badge counts EVERY waiting payment, not just those on this page — a badge that changed
	// as somebody paged would be reporting the page rather than the work.
	for _, count := range waiting {
		totalWaiting += count
	}

	items, ids := positionListItems(positions, req.Msg.GetDataRequest())

	return connect.NewResponse(&liabilityv1.LiabilityPositionListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
		AwaitingConfirmation:          totalWaiting,
		TotalReceivable:               summary.TotalReceivable,
		TotalPayable:                  summary.TotalPayable,
		OldestUnsettledCounterpartyId: summary.OldestCounterpartyID,
		OldestUnsettledAtUnix:         summary.OldestUnsettledAtUnix,
	}), nil
}

// awaitingConfirmation lives in awaiting_confirmation.go — it grew a real query when payments landed
// (#188).

// positionRows is `scope` narrowed by the pair list's three row filters, as a function for the same reason `scope`
// is one: the count and the page must be built fresh from one definition.
//
// ⚠ THE SEARCH AND THE KIND ARE TEAM_SERVICE'S FACTS, never a join (HARD RULE 3). The team's own pairs are read here —
// one index-only read of `liability_balances (team_id, counterparty_id)`, bounded by the teams it trades with — and
// their names, codes and types are asked of team_service through the in-process seam; the ids that match narrow the
// SQL. A pair whose team team_service does not know never matches either filter.
func (s *Service) positionRows(
	ctx context.Context,
	teamID uint64,
	filter *liabilityv1.LiabilityPositionListFilter,
	scope func() *gorm.DB,
) (func() *gorm.DB, error) {
	q := strings.TrimSpace(filter.GetQ())
	kind := filter.GetCounterpartyType()

	var matched []uint64

	byTeam := q != "" || kind != teamv1.TeamType_TEAM_TYPE_UNSPECIFIED

	if byTeam {
		var ids []uint64

		err := scope().
			Pluck("counterparty_id", &ids).
			Error
		if err != nil {
			return nil, dbError(err)
		}

		facts := map[uint64]TeamFact{}

		if len(ids) > 0 {
			facts, err = s.names.TeamFacts(ctx, ids)
			if err != nil {
				// team_service's own refusal reaches the caller with its own code, as checkAccount does.
				var connectErr *connect.Error
				if errors.As(err, &connectErr) {
					return nil, connectErr
				}

				return nil, connect.NewError(connect.CodeUnavailable, err)
			}
		}

		matched = make([]uint64, 0, len(ids))

		for _, id := range ids {
			fact, known := facts[id]
			if teamMatches(fact, known, q, kind) {
				matched = append(matched, id)
			}
		}
	}

	awaitingOnly := filter.GetAwaitingOnly()

	return func() *gorm.DB {
		query := scope()

		if byTeam {
			if len(matched) == 0 {
				// Nothing matched: an empty answer, still counted by the same query as a full one.
				query = query.Where("FALSE")
			} else {
				query = query.Where("counterparty_id IN ?", matched)
			}
		}

		if awaitingOnly {
			// The rows the badge counts: a payment the counterparty recorded TO this team, still awaiting its accept or
			// reject — awaitingConfirmation's own predicate, read by `liability_payments_awaiting_idx`.
			query = query.Where("counterparty_id IN (?)", s.db.
				WithContext(ctx).
				Model(&liability_service_models.LiabilityPayment{}).
				Select("payer_team_id").
				Where("creditor_team_id = ? AND status = ?", teamID, paymentRecorded))
		}

		return query
	}, nil
}
