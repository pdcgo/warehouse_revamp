package expense_v1

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
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
//
// ANALYTIC (expense-figures-are-read-from-its-own-records): a typed expense also adds its amount to its day's
// `expense_metric_daily_reports` row — on its own `occurred_at`, for the person who typed it — in the SAME transaction
// (foldMetric). Which side its team sits on (Seller or Warehouse) is asked of team_service before the transaction. A
// STOCK_LOSS adds nothing (stock-loss-stays-out-of-analytic-expenses) and asks nothing.
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

	// THE FREEZE POINT, exact (the-backend-never-rounds-money) — a stock loss arrives from inventory priced at a FIFO
	// unit cost, a fraction, and is stored as that fraction. One that is not above 0 (or is not a number at all) is
	// refused: an expense of nothing is not one.
	amount := req.Msg.GetAmount()
	if !san_money.Positive(amount) {
		return nil, costErr(errZeroExpense)
	}

	row := expense_service_models.ExpenseRecord{
		TeamID:           req.Msg.GetTeamId(),
		ShopID:           req.Msg.GetShopId(),
		Kind:             int32(kind),
		Amount:           amount,
		OccurredAt:       occurred,
		Note:             req.Msg.GetNote(),
		CreatedBy:        actorFrom(ctx),
		IsOverride:       overrideFrom(ctx),
		FinanceAccountID: account,
	}

	// Where the team's expenses sit in Analytic — asked BEFORE the transaction, like the account: a call to another
	// service never holds a pooled connection across its round-trip.
	side := SideNeither
	if typedKind(kind) {
		side, err = s.sides.SideOf(ctx, row.TeamID)
		if err != nil {
			return nil, costErr(fmt.Errorf("ask the team's side: %w", err))
		}
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Create(&row).Error
		if err != nil {
			return err
		}

		// The Analytic report, in the expense's own transaction — the last lock it takes.
		return foldMetric(tx, &row, side)
	})
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
