package financial_account_v1

import (
	"context"
	"math"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// FinancialAccountCreate records one of the team's accounts — and posts its OPENING BALANCE as its first row,
// in the same transaction, even at 0 (an-account-opens-with-a-log-row), so every account's statement starts
// with a row that explains where its first number came from.
//
// Refused: a number already recorded in ANY team (a-real-account-is-recorded-once), a name the team already
// uses, a type or provider `unknown`, a day after today, a balance below zero.
func (s *Service) FinancialAccountCreate(
	ctx context.Context,
	req *connect.Request[financial_accountv1.FinancialAccountCreateRequest],
) (*connect.Response[financial_accountv1.FinancialAccountCreateResponse], error) {
	msg := req.Msg

	id, err := checkIdentity(msg.GetType(), msg.GetProvider(), msg.GetAccountNumber())
	if err != nil {
		return nil, err
	}

	name, err := cleanName(msg.GetName())
	if err != nil {
		return nil, err
	}

	opening := msg.GetOpeningBalance()
	if opening < 0 || math.IsInf(opening, 0) || math.IsNaN(opening) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errOpeningBelowZero)
	}

	occurredAt, err := s.pickedDay(msg.GetOpeningOn())
	if err != nil {
		return nil, err
	}

	actor := actorFrom(ctx)

	var created m.FinancialAccount

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := numberFree(tx, id, 0)
		if err != nil {
			return err
		}

		err = nameFree(tx, msg.GetTeamId(), name, 0)
		if err != nil {
			return err
		}

		created = m.FinancialAccount{
			TeamID:        msg.GetTeamId(),
			Type:          id.accountType,
			Provider:      id.provider,
			Status:        m.StatusActive,
			AccountNumber: id.number,
			Name:          name,
			HolderName:    strings.TrimSpace(msg.GetHolderName()),
			Description:   msg.GetDescription(),
		}

		err = tx.Create(&created).Error
		if err != nil {
			return err
		}

		// Locked like any other post, though nobody else can see the row yet — post's contract is a locked
		// account, and keeping one way in is cheaper than reasoning about an exception.
		locked, err := lockAccount(tx, created.TeamID, created.ID)
		if err != nil {
			return err
		}

		_, err = post(tx, locked, entry{
			changeType:  m.ChangeOpeningBalance,
			change:      opening,
			description: "Opening balance",
			occurredAt:  occurredAt,
			actorID:     actor,
		})

		return err
	})
	if err != nil {
		return nil, uniqueOrInternal(err)
	}

	account, err := reloadAccount(s.db.WithContext(ctx), created.ID)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&financial_accountv1.FinancialAccountCreateResponse{Account: account}), nil
}
