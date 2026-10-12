package liability_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

// LiabilityPaymentList reads the payments this team is a party to (#188) — BOTH DIRECTIONS, the ones
// it made and the ones it was paid.
//
// One list rather than two, for the same reason the counterparty history is one list: a payment is
// one relationship seen from two sides, and making a manager visit two screens to answer "are we
// square" is how the question stops getting asked.
//
// ⚠ `awaiting_my_confirmation` IS THE BADGE (#188 Q10). A payment nobody notices is a debt that stays
// open for no reason, so the creditor must be able to ask "what needs me" without hunting. It means
// RECORDED payments where THIS team is the creditor — never the ones it recorded itself, which are
// waiting on somebody else.
func (s *Service) LiabilityPaymentList(
	ctx context.Context,
	req *connect.Request[liabilityv1.LiabilityPaymentListRequest],
) (*connect.Response[liabilityv1.LiabilityPaymentListResponse], error) {
	teamID := req.Msg.GetTeamId()
	filter := req.Msg.GetFilter()
	page := req.Msg.GetPage()

	query := s.paymentScope(ctx, teamID, filter)

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var rows []liability_service_models.LiabilityPayment

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = query.
		// ⚠ PRELOADED, NOT LAZY (a-payment-must-carry-proof). Every row on this list shows whether it
		// carries proof, and a list that forgot this would render every payment as having none — which
		// reads as the payer skipping a required step rather than as a missing join.
		Preload("Documents").
		// Newest first: the thing somebody just recorded is the thing somebody is asking about.
		Order("id DESC").
		Offset(offset).
		Limit(int(page.GetLimit())).
		Find(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	out := make([]*liabilityv1.LiabilityPayment, 0, len(rows))
	for i := range rows {
		out = append(out, paymentToProto(&rows[i]))
	}

	items, ids := paymentListItems(out, req.Msg.GetDataRequest())

	return connect.NewResponse(&liabilityv1.LiabilityPaymentListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}

// paymentScope builds the WHERE shared by the count and the page, so the two can never disagree about
// what is being listed — a total computed over a different set than the rows is a pager that lies.
func (s *Service) paymentScope(
	ctx context.Context,
	teamID uint64,
	filter *liabilityv1.LiabilityPaymentListFilter,
) *gorm.DB {
	query := s.db.
		WithContext(ctx).
		Model(&liability_service_models.LiabilityPayment{})

	if filter.GetAwaitingMyConfirmation() {
		// The inbox: recorded by the other side, waiting on THIS team. Deliberately not "or payer" —
		// a payment this team recorded is waiting on somebody else and belongs in nobody's inbox.
		query = query.Where("creditor_team_id = ? AND status = ?", teamID, paymentRecorded)
	} else {
		query = query.Where("payer_team_id = ? OR creditor_team_id = ?", teamID, teamID)
	}

	if counterpartyID := filter.GetCounterpartyId(); counterpartyID != 0 {
		// The other side of the pair, whichever side this team is on. Wrapped in its own group because
		// the clause above is an OR — without the grouping this would widen the scope instead of
		// narrowing it, and a team would read another pair's payments.
		query = query.Where(
			s.db.Where("payer_team_id = ?", counterpartyID).
				Or("creditor_team_id = ?", counterpartyID),
		)
	}

	return query
}
