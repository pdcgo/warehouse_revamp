package expense_v1

import (
	"context"

	"connectrpc.com/connect"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

// ExpenseCreate records money that went out (#168).
//
// The row says WHO TYPED IT, taken from the caller's identity rather than the request. A client
// supplying its own `created_by` could file somebody else's name against a number that moves profit,
// and the one thing this field exists for is to answer "whose number is this".
//
// PAID FROM (an-expense-must-name-the-account-that-paid): every kind a person types names the account that paid it,
// one of the team's ACTIVE OPERATIONAL accounts — asked of financial_account_service through the composition root,
// before the insert, never under a transaction. Anything else is FailedPrecondition, naming it. After the commit the
// expense is published (ExpenseCreated), and that account is posted — `ads_expense` for ADS, `expense` for the rest.
//
// STOCK_LOSS is outside the rule: inventory records it by an internal call (no validation interceptor), it moves no
// cash, so it is stored with no account — whatever was sent — and never published.
//
// THE SHOP IS FOR ADS ONLY, AND ADS NEEDS ONE (an-expense-names-a-shop-only-for-ads): InvalidArgument either way.
func (s *Service) ExpenseCreate(
	ctx context.Context,
	req *connect.Request[expensev1.ExpenseCreateRequest],
) (*connect.Response[expensev1.ExpenseCreateResponse], error) {
	// The date the cost BELONGS TO. Re-checked here rather than trusted from the pattern: unit tests
	// bypass the validation interceptor, and a pattern cannot tell "2026-02-31" from a real day.
	occurred, err := parseDate(req.Msg.GetOccurredAt())
	if err != nil {
		return nil, costErr(err)
	}

	kind := req.Msg.GetKind()
	account := req.Msg.GetFinanceAccountId()

	err = shopRule(kind, req.Msg.GetShopId())
	if err != nil {
		return nil, costErr(err)
	}

	if kind == expensev1.ExpenseKind_EXPENSE_KIND_STOCK_LOSS {
		account = 0
	} else {
		if account == 0 {
			return nil, costErr(errNoAccount)
		}

		err = s.checkPayingAccount(ctx, req.Msg.GetTeamId(), account)
		if err != nil {
			return nil, costErr(err)
		}
	}

	row := expense_service_models.ExpenseRecord{
		TeamID:           req.Msg.GetTeamId(),
		ShopID:           req.Msg.GetShopId(),
		Kind:             int32(kind),
		Amount:           req.Msg.GetAmount(),
		OccurredAt:       occurred,
		Note:             req.Msg.GetNote(),
		CreatedBy:        actorFrom(ctx),
		IsOverride:       overrideFrom(ctx),
		FinanceAccountID: account,
	}

	err = s.db.WithContext(ctx).Create(&row).Error
	if err != nil {
		return nil, costErr(err)
	}

	// AFTER the commit: the paying account hears the money left it.
	if moves(&row) {
		s.publishMoney(ctx, expenseCreatedEvent(&row))
	}

	// A new expense has no adjustments yet: it counts for its own amount.
	return connect.NewResponse(&expensev1.ExpenseCreateResponse{Expense: costToProto(&row, row.Amount)}), nil
}

// shopRule is an-expense-names-a-shop-only-for-ads: ADS names the shop it ran for, every other kind names none.
// STOCK_LOSS is no exception — inventory never sends a shop.
func shopRule(kind expensev1.ExpenseKind, shopID uint64) error {
	if kind == expensev1.ExpenseKind_EXPENSE_KIND_ADS {
		if shopID == 0 {
			return errAdsNeedsAShop
		}

		return nil
	}

	if shopID != 0 {
		return errShopIsForAdsOnly
	}

	return nil
}
