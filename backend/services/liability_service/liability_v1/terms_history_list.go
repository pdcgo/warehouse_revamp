package liability_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

// LiabilityTermsHistoryList serves the LIMIT log on the pair detail (a-limit-change-is-recorded).
//
// ⚠ IT IS NOT THE LEDGER, and the two must never merge (the-pair-detail-shows-both-logs). This is a
// RULE that changed; `LiabilityLogList` is MONEY that moved. They share a page because somebody
// asking "why is this team blocked" needs both, and they have different grains — only one of them
// comes in balancing pairs.
//
// ⚠ THE SCOPE IS `team_id` AND ONLY `team_id`, the creditor whose terms these are. `counterparty_id`
// in the filter NARROWS and authorizes nothing — the same trap `LiabilityPositionList` names, and the
// easiest authorization mistake available in this service.
//
// ⚠ THE COUNTERPARTY FILTER IS `optional`, because 0 IS A REAL VALUE — the default row. A caller
// wanting every counterparty's history omits the field; one wanting the house rate's history sends 0.
// A plain uint64 could not express the difference, which is why the proto field carries `optional`
// and this handler reads the pointer rather than the getter.
func (s *Service) LiabilityTermsHistoryList(
	ctx context.Context,
	req *connect.Request[liabilityv1.LiabilityTermsHistoryListRequest],
) (*connect.Response[liabilityv1.LiabilityTermsHistoryListResponse], error) {
	page := req.Msg.GetPage()

	scope := func() *gorm.DB {
		q := s.db.
			WithContext(ctx).
			Model(&liability_service_models.LiabilityTermsLog{}).
			Where("team_id = ?", req.Msg.GetTeamId())

		// NOT GetCounterpartyId() — that flattens "every counterparty" and "the default row" into the
		// same 0, and they are different questions.
		if id := req.Msg.GetFilter().CounterpartyId; id != nil {
			q = q.Where("counterparty_id = ?", *id)
		}

		return q
	}

	var total int64

	err := scope().Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var rows []liability_service_models.LiabilityTermsLog

	offset := int((page.GetPage() - 1) * page.GetLimit())

	// NEWEST FIRST — a limit log is read to answer "what changed recently", and the most recent
	// change is the one that explains today's behaviour. `id` breaks ties so paging is stable when
	// two changes land in the same clock tick.
	err = scope().
		Order("changed_at DESC, id DESC").
		Offset(offset).
		Limit(int(page.GetLimit())).
		Find(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	out := make([]*liabilityv1.LiabilityTermsChange, 0, len(rows))
	for i := range rows {
		out = append(out, termsChangeToProto(&rows[i]))
	}

	items, ids := termsChangeListItems(out, req.Msg.GetDataRequest())

	return connect.NewResponse(&liabilityv1.LiabilityTermsHistoryListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}

// termsChangeToProto carries BOTH limit NULLs through as absent fields.
//
// ⚠ Same trap as `termsToProto`, twice over: absent is UNLIMITED and 0 is NO CREDIT AT ALL, and this
// log exists precisely to tell those two apart. It works only because the model's fields are already
// pointers — the moment either stops being one, every "the limit was removed" entry silently starts
// reading as "the team was frozen".
func termsChangeToProto(c *liability_service_models.LiabilityTermsLog) *liabilityv1.LiabilityTermsChange {
	return &liabilityv1.LiabilityTermsChange{
		Id:                 c.ID,
		CounterpartyId:     c.CounterpartyID,
		ActorId:            c.ActorID,
		OldCreditLimit:     c.OldCreditLimit,
		NewCreditLimit:     c.NewCreditLimit,
		OldHandlingFee:     c.OldHandlingFee,
		NewHandlingFee:     c.NewHandlingFee,
		OldProductMarkupBp: c.OldProductMarkupBp,
		NewProductMarkupBp: c.NewProductMarkupBp,
		Reason:             c.Reason,
		Override:           c.Override,
		ChangedAtUnix:      c.ChangedAt.Unix(),
	}
}
