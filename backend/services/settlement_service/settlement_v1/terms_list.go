package settlement_v1

import (
	"context"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// SettlementTermsList reads the terms the scoped team SETS AS A CREDITOR (#189) — what it charges
// each debtor and how far it will let them run.
//
// ⚠ IT READS THE CREDITOR SIDE ONLY, and that is the whole scope rule here. `team_id` is the team
// that WROTE these rows; a debtor asking what it is charged is asking about somebody else's
// configuration, and gets its own (empty) list rather than theirs. That mirrors how the ledger's own
// reads work — the scope is always "my books".
//
// THE DEFAULT ROW LEADS. `counterparty_id = 0` is the rate applying to every team without one of
// their own, so it is the first thing to read and `ORDER BY counterparty_id` puts it there without a
// special case. Paging is by the same key, which is stable because the pair is unique.
func (s *Service) SettlementTermsList(
	ctx context.Context,
	req *connect.Request[settlementv1.SettlementTermsListRequest],
) (*connect.Response[settlementv1.SettlementTermsListResponse], error) {
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&settlement_service_models.SettlementTerms{}).
		Where("team_id = ?", req.Msg.GetTeamId())

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var rows []settlement_service_models.SettlementTerms

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = query.
		Order("counterparty_id ASC").
		Offset(offset).
		Limit(int(page.GetLimit())).
		Find(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	out := make([]*settlementv1.SettlementTerms, 0, len(rows))
	for i := range rows {
		out = append(out, termsToProto(&rows[i]))
	}

	items, ids := termsListItems(out, req.Msg.GetDataRequest())

	return connect.NewResponse(&settlementv1.SettlementTermsListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}

// termsToProto carries the NULL through as an ABSENT field rather than a zero.
//
// ⚠ This is the one mapping in this package where a wrong `0` inverts the meaning: absent is
// UNLIMITED credit and 0 is NO credit at all. Assigning `CreditLimit: row.CreditLimit` works only
// because the model's field is already a pointer — if it ever stops being one, this line silently
// starts granting infinite credit to every frozen team.
func termsToProto(t *settlement_service_models.SettlementTerms) *settlementv1.SettlementTerms {
	return &settlementv1.SettlementTerms{
		TeamId:          t.TeamID,
		CounterpartyId:  t.CounterpartyID,
		HandlingFee:     t.HandlingFee,
		ProductMarkupBp: t.ProductMarkupBP,
		CreditLimit:     t.CreditLimit,
	}
}
