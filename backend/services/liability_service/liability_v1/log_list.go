package liability_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

// LiabilityLogList is the counterparty detail's running history (#185): every entry between the
// scoped team and one counterparty, newest first, with the pair's current balance.
//
// This is what `(source_type, source_id)` was for. A line reads "COD fee, restock #412" — joinable,
// filterable, countable — rather than a free-text note nobody can do anything with. An order's fee
// and its cancellation reversal both appear, netting to zero and still visible, because a reversal is
// a compensating entry and never a delete.
//
// ⚠ `counterparty_id` is REQUIRED here and is still NOT the scope. The handler proves the caller
// belongs to `team_id` and then reads the pair; a request naming somebody else's pair returns that
// caller's own (empty) history rather than anybody else's.
//
// THE PERIOD AND THE DIRECTION NARROW BEFORE THE PAGE (backlog #34) — each tab of the pair page reads its own filtered
// page. `balance_after` needs nothing for it: it is stored on each row when the row is posted, so a filtered row still
// carries the running balance of the WHOLE ledger after it, never a sum over what the filter returned.
func (s *Service) LiabilityLogList(
	ctx context.Context,
	req *connect.Request[liabilityv1.LiabilityLogListRequest],
) (*connect.Response[liabilityv1.LiabilityLogListResponse], error) {
	teamID := req.Msg.GetTeamId()
	filter := req.Msg.GetFilter()
	counterpartyID := filter.GetCounterpartyId()
	page := req.Msg.GetPage()

	start, end, err := listPeriod(filter.GetFrom(), filter.GetTo())
	if err != nil {
		return nil, err
	}

	query := s.db.
		WithContext(ctx).
		Model(&liability_service_models.LiabilityLog{}).
		Where("team_id = ? AND counterparty_id = ?", teamID, counterpartyID)

	if start != nil {
		query = query.Where("created_at >= ?", *start)
	}

	if end != nil {
		query = query.Where("created_at < ?", *end)
	}

	// By SIGN, as the tabs read: a payment this team made lands under Receivable, because it moved the pair toward it.
	switch filter.GetDirection() {
	case liabilityv1.LiabilityLogDirection_LIABILITY_LOG_DIRECTION_RECEIVABLE:
		query = query.Where("amount > 0")
	case liabilityv1.LiabilityLogDirection_LIABILITY_LOG_DIRECTION_PAYABLE:
		query = query.Where("amount < 0")
	}

	var total int64

	err = query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var entries []liability_service_models.LiabilityLog

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = query.
		Order("id DESC").
		Offset(offset).
		Limit(int(page.GetLimit())).
		Find(&entries).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	// The pair's balance, so the page header needs no second call — the WHOLE pair's, whatever the filter. A pair with
	// no entries has no balance row either, and that reads as ZERO rather than as an error: "we have never traded" and
	// "we are square" are the same answer to the question this screen asks.
	var stored liability_service_models.LiabilityBalance

	err = s.db.
		WithContext(ctx).
		Where("team_id = ? AND counterparty_id = ?", teamID, counterpartyID).
		Take(&stored).
		Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, dbError(err)
	}

	out := make([]*liabilityv1.LiabilityLog, 0, len(entries))
	for i := range entries {
		out = append(out, entryToProto(&entries[i]))
	}

	items, ids := entryListItems(out, req.Msg.GetDataRequest())

	return connect.NewResponse(&liabilityv1.LiabilityLogListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
		Balance: stored.Balance,
	}), nil
}

func entryToProto(e *liability_service_models.LiabilityLog) *liabilityv1.LiabilityLog {
	return &liabilityv1.LiabilityLog{
		Id:             e.ID,
		TeamId:         e.TeamID,
		CounterpartyId: e.CounterpartyID,
		Amount:         e.Amount,
		SourceType:     sourceTypeProto(e.SourceType),
		SourceId:       e.SourceID,
		Reversal:       e.Reversal,
		GroupId:        e.GroupID,
		BalanceAfter:   e.BalanceAfter,
		CreatedAtUnix:  e.CreatedAt.Unix(),
	}
}
