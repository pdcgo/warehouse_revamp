package financial_account_v1

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

var (
	errNoDirection = connect.NewError(connect.CodeInvalidArgument, errors.New("say whether the money goes in or out"))

	errUnknownHandRow = connect.NewError(
		connect.CodeFailedPrecondition,
		errors.New("an unknown account takes no row by hand but a transfer out — name its bank first"),
	)
)

// FinancialAccountCapital records the business owner's own money, put in or taken out — one `capital` row
// (capital-joins-the-types). The person picks a DIRECTION and a positive amount; the sign is applied here,
// never typed.
func (s *Service) FinancialAccountCapital(
	ctx context.Context,
	req *connect.Request[financial_accountv1.FinancialAccountCapitalRequest],
) (*connect.Response[financial_accountv1.FinancialAccountCapitalResponse], error) {
	msg := req.Msg

	var sign float64

	switch msg.GetDirection() {
	case financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_IN:
		sign = 1
	case financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_OUT:
		sign = -1
	default:
		return nil, errNoDirection
	}

	if !validAmount(msg.GetAmount()) {
		return nil, errNoAmount
	}

	occurredAt, err := s.pickedDay(msg.GetOccurredOn())
	if err != nil {
		return nil, err
	}

	actor := actorFrom(ctx)

	var row m.FinancialAccountLog

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		account, err := lockAccount(tx, msg.GetTeamId(), msg.GetAccountId())
		if err != nil {
			return err
		}

		if account.Status != m.StatusActive {
			return errArchived(account.Name)
		}

		if account.Type == m.TypeUnknown {
			return errUnknownHandRow
		}

		direction := "in"
		if sign < 0 {
			direction = "out"
		}

		description := "Capital " + direction
		if note := strings.TrimSpace(msg.GetNote()); note != "" {
			description += " — " + note
		}

		row, err = post(tx, account, entry{
			changeType:  m.ChangeCapital,
			change:      sign * rupiah(msg.GetAmount()),
			description: description,
			occurredAt:  occurredAt,
			actorID:     actor,
		})

		return err
	})
	if err != nil {
		return nil, uniqueOrInternal(err)
	}

	return connect.NewResponse(&financial_accountv1.FinancialAccountCapitalResponse{Log: logToProto(row)}), nil
}
