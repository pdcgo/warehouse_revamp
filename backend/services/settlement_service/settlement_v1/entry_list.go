package settlement_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// SettlementEntryList is the counterparty detail's running history (#185): every entry between the
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
func (s *Service) SettlementEntryList(
	ctx context.Context,
	req *connect.Request[settlementv1.SettlementEntryListRequest],
) (*connect.Response[settlementv1.SettlementEntryListResponse], error) {
	teamID := req.Msg.GetTeamId()
	counterpartyID := req.Msg.GetCounterpartyId()
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&settlement_service_models.SettlementEntry{}).
		Where("team_id = ? AND counterparty_id = ?", teamID, counterpartyID)

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var entries []settlement_service_models.SettlementEntry

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

	// The pair's balance, so the page header needs no second call. A pair with no entries has no
	// balance row either, and that reads as ZERO rather than as an error: "we have never traded" and
	// "we are square" are the same answer to the question this screen asks.
	var stored settlement_service_models.SettlementBalance

	err = s.db.
		WithContext(ctx).
		Where("team_id = ? AND counterparty_id = ?", teamID, counterpartyID).
		Take(&stored).
		Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, dbError(err)
	}

	out := make([]*settlementv1.SettlementEntry, 0, len(entries))
	for i := range entries {
		out = append(out, entryToProto(&entries[i]))
	}

	return connect.NewResponse(&settlementv1.SettlementEntryListResponse{
		Entries: out,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
		Balance: stored.Balance,
	}), nil
}

func entryToProto(e *settlement_service_models.SettlementEntry) *settlementv1.SettlementEntry {
	return &settlementv1.SettlementEntry{
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
