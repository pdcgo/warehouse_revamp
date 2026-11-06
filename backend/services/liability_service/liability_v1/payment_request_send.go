package liability_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

var errNothingOwed = errors.New("the debtor owes this team nothing now, so there is nothing to ask for")

// LiabilityPaymentRequestSend lets a CREDITOR ask its debtor to pay (a-creditor-may-request-payment). It POSTS NOTHING and BLOCKS NOTHING:
// the request is a notice the debtor sees on its balance and on the pair detail. Payment still starts with the debtor,
// through the payment flow as it is; lowering the limit stays the last resort, never the way to ask.
//
// The amount is what the debtor owes NOW, read from the creditor's side of the pair — positive means owed. Sending again
// replaces the request (one per pair), with the moment's figure.
func (s *Service) LiabilityPaymentRequestSend(
	ctx context.Context,
	req *connect.Request[liabilityv1.LiabilityPaymentRequestSendRequest],
) (*connect.Response[liabilityv1.LiabilityPaymentRequestSendResponse], error) {
	creditor := req.Msg.GetTeamId()
	debtor := req.Msg.GetDebtorTeamId()

	if creditor == debtor {
		return nil, connect.NewError(connect.CodeInvalidArgument, errSameTeam)
	}

	var balance liability_service_models.LiabilityBalance

	err := s.db.WithContext(ctx).
		Where("team_id = ? AND counterparty_id = ?", creditor, debtor).
		Take(&balance).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && !san_money.Positive(balance.Balance)) {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errNothingOwed)
	}

	if err != nil {
		return nil, dbError(err)
	}

	request := liability_service_models.LiabilityPaymentRequest{
		CreditorTeamID:    creditor,
		DebtorTeamID:      debtor,
		Amount:            balance.Balance,
		RequestedByUserID: actorUserID(ctx),
		CreatedAt:         time.Now(),
		IsOverride:        isOverride(ctx),
	}

	// One per pair: a second request REPLACES the first, with the moment's figure and its sender — and whether that
	// sender was an override, which follows the sender.
	err = s.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "creditor_team_id"}, {Name: "debtor_team_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"amount", "requested_by_user_id", "created_at", "is_override"}),
		}).
		Create(&request).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&liabilityv1.LiabilityPaymentRequestSendResponse{Request: paymentRequestToProto(&request)}), nil
}

func paymentRequestToProto(r *liability_service_models.LiabilityPaymentRequest) *liabilityv1.LiabilityPaymentRequest {
	return &liabilityv1.LiabilityPaymentRequest{
		CreditorTeamId:    r.CreditorTeamID,
		DebtorTeamId:      r.DebtorTeamID,
		Amount:            r.Amount,
		RequestedByUserId: r.RequestedByUserID,
		RequestedAtUnix:   r.CreatedAt.Unix(),
	}
}

// openPaymentRequests is every request on a pair this team is in, either way, keyed by the COUNTERPARTY — what the
// position read carries beside each balance.
func (s *Service) openPaymentRequests(ctx context.Context, teamID uint64) (map[uint64]*liabilityv1.LiabilityPaymentRequest, error) {
	var rows []liability_service_models.LiabilityPaymentRequest

	err := s.db.WithContext(ctx).
		Where("creditor_team_id = ? OR debtor_team_id = ?", teamID, teamID).
		Find(&rows).
		Error
	if err != nil {
		return nil, err
	}

	out := make(map[uint64]*liabilityv1.LiabilityPaymentRequest, len(rows))
	for i := range rows {
		counterparty := rows[i].DebtorTeamID
		if counterparty == teamID {
			counterparty = rows[i].CreditorTeamID
		}

		out[counterparty] = paymentRequestToProto(&rows[i])
	}

	return out, nil
}
