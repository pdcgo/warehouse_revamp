package liability_v1

import (
	"context"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
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

	query := s.db.
		WithContext(ctx).
		Model(&liability_service_models.LiabilityBalance{}).
		Where("team_id = ?", teamID)

	if counterparty := req.Msg.GetFilter().GetCounterpartyId(); counterparty != 0 {
		query = query.Where("counterparty_id = ?", counterparty)
	}

	// A settled pair keeps its row forever — the ledger never deletes anything — so the default view
	// would otherwise fill with zeros and bury the rows a manager opened the screen for.
	if req.Msg.GetFilter().GetUnsettledOnly() {
		query = query.Where("balance <> 0")
	}

	var total int64

	err := query.Count(&total).Error
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

	positions := make([]*liabilityv1.LiabilityPosition, 0, len(balances))

	var totalWaiting uint32

	for i := range balances {
		row := &liabilityv1.LiabilityPosition{
			CounterpartyId:       balances[i].CounterpartyID,
			Balance:              balances[i].Balance,
			AwaitingConfirmation: waiting[balances[i].CounterpartyID],
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
		AwaitingConfirmation: totalWaiting,
	}), nil
}

// awaitingConfirmation lives in awaiting_confirmation.go — it grew a real query when payments landed
// (#188).
