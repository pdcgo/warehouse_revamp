package financial_account_v1

import (
	"context"
	"errors"

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
//
// THE SECOND DOOR (prive-and-deposit-on-pengeluaran-are-the-accounts-capital): after the commit the row is told to the
// broker (FinancialAccountCapitalRecorded, capital_recorded.go) — expense_service records a SELLING team's as the same
// one record on Biaya (Setoran modal / Prive, *Dicatat di halaman akun*) and posts nothing back; a warehouse team's it
// drops. The row itself, the roles that may make it and the balance moving at once are as they always were.
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
	override := overrideFrom(ctx)

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

		row, err = post(tx, account, entry{
			changeType:  m.ChangeCapital,
			change:      sign * msg.GetAmount(),
			description: capitalDescription(direction, msg.GetNote()),
			occurredAt:  occurredAt,
			actorID:     actor,
			isOverride:  override,
		})

		return err
	})
	if err != nil {
		return nil, uniqueOrInternal(err)
	}

	// AFTER the commit: Biaya hears of it (a selling team's shows there — the same one record).
	s.publishCapital(ctx, capitalRecordedEvent(&row))

	return connect.NewResponse(&financial_accountv1.FinancialAccountCapitalResponse{Log: logToProto(row)}), nil
}
