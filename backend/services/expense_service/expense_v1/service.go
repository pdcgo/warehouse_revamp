// Package expense_v1 implements warehouse.expense.v1.ExpenseService — money the business spent that NO ORDER
// caused (#161): ads budget, payroll, rent.
//
// Every RPC is team-scoped: the request carries team_id (use_scope) and each query is constrained to
// it, so one team can never read or move another's costs. This is the money, so that matters more
// here than on most lists.
package expense_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1/expensev1connect"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

type Service struct {
	db       *gorm.DB
	events   event_source.EventSender
	accounts PayingAccounts
}

// compile-time proof Service satisfies the generated handler interface.
var _ expensev1connect.ExpenseServiceHandler = (*Service)(nil)

// NewService builds the handlers. `events` carries ExpenseCreated / ExpenseAdjusted to whoever posts the money
// (financial_account_service); `accounts` answers whether the account an expense names may pay it — both from the
// composition root, the one place allowed to know two services at once.
func NewService(db *gorm.DB, events event_source.EventSender, accounts PayingAccounts) *Service {
	// A nil sender would panic on the first expense. EmptySender still VALIDATES the event, so a malformed one is caught
	// with no broker in sight — the right default for a test.
	if events == nil {
		events = event_source.EmptySender
	}

	// With no account service to ask, every account is REFUSED rather than trusted — a test that records only a
	// STOCK_LOSS never asks.
	if accounts == nil {
		accounts = noPayingAccounts{}
	}

	return &Service{db: db, events: events, accounts: accounts}
}

// The date layout every cost date crosses the wire in. A DATE, not a timestamp: nobody records the
// hour the rent was paid, and a timestamp would invite a timezone question that has no answer here.
const dateLayout = "2006-01-02"

var (
	errBadDate     = errors.New("a date must be YYYY-MM-DD")
	errCostMissing = errors.New("cost not found")
	// An adjustment corrects an EXPENSE. A mistaken adjustment is fixed by a second one on the same expense, so the
	// corrections never form a chain somebody has to walk to find the number.
	errAdjustsAnAdjustment = errors.New("an adjustment corrects an expense, never another adjustment")
	// A correction cannot turn a cost into income: an expense and its adjustments never sum below 0.
	errBelowZero      = errors.New("the correction would take the expense below 0")
	errZeroCorrection = errors.New("a correction of 0 corrects nothing")

	// Every expense a person types names the account that paid it (an-expense-must-name-the-account-that-paid). The
	// validation interceptor says it first (`uint64.gt = 0`); this is the handler not trusting a caller that skips it.
	errNoAccount = errors.New("finance_account_id: an expense names the account that paid it")
	// Only an ADS expense names a shop, and it must (an-expense-names-a-shop-only-for-ads). The words are the screen's
	// own (the Storybook stub says the same).
	errAdsNeedsAShop    = errors.New("an ads expense names its shop")
	errShopIsForAdsOnly = errors.New("only an ads expense names a shop")
	// The account is not one the team may pay an expense from — wrapped with its name (accountRefusal).
	errNotOperational = errors.New("not one of the team's active operational accounts")
)

func costErr(err error) error {
	switch {
	case errors.Is(err, errBadDate), errors.Is(err, errZeroCorrection), errors.Is(err, errNoAccount),
		errors.Is(err, errAdsNeedsAShop), errors.Is(err, errShopIsForAdsOnly):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, gorm.ErrRecordNotFound):
		// NotFound, never PermissionDenied: another team's cost must be indistinguishable from one that
		// does not exist, or the error itself confirms the id.
		return connect.NewError(connect.CodeNotFound, errCostMissing)
	case errors.Is(err, errAdjustsAnAdjustment), errors.Is(err, errBelowZero), errors.Is(err, errNotOperational):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}

// parseDate turns a wire date into a time.Time, in UTC.
//
// Proto validation already enforces the SHAPE (a pattern), but shape is not validity: "2026-02-31"
// matches the pattern and is not a day. time.Parse rejects it, which is why this re-checks rather than
// trusting the regex — and unit tests bypass the validation interceptor anyway.
func parseDate(raw string) (time.Time, error) {
	t, err := time.Parse(dateLayout, raw)
	if err != nil {
		return time.Time{}, errBadDate
	}

	return t, nil
}

// actorFrom pulls the acting user's id from the request identity.
//
// 0 if somehow absent — the row records WHO, but a missing actor must not fail a cost somebody is
// trying to record. A blank name on a real number beats losing the number.
func actorFrom(ctx context.Context) uint64 {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return 0
	}

	return identity.GetIdentityId()
}

// overrideFrom is whether actorFrom is Root or the Administrator typing inside a team they hold no role in — through
// the root-team bypass, not a membership (an-override-is-stamped-in-every-service). Stamped beside created_by.
func overrideFrom(ctx context.Context) bool {
	return san_auth.IsOverride(ctx)
}

// costToProto is one row on the wire. `net` is what an EXPENSE counts for after its adjustments; an adjustment
// carries none.
func costToProto(c *expense_service_models.ExpenseRecord, net int64) *expensev1.ExpenseRecord {
	if c.AdjustsExpenseID != 0 {
		net = 0
	}

	return &expensev1.ExpenseRecord{
		Id:               c.ID,
		TeamId:           c.TeamID,
		ShopId:           c.ShopID,
		Kind:             expensev1.ExpenseKind(c.Kind),
		Amount:           c.Amount,
		OccurredAt:       c.OccurredAt.Format(dateLayout),
		Note:             c.Note,
		CreatedBy:        c.CreatedBy,
		CreatedAtUnix:    c.CreatedAt.Unix(),
		AdjustsExpenseId: c.AdjustsExpenseID,
		NetAmount:        net,
		FinanceAccountId: c.FinanceAccountID,
	}
}

// adjustedSums is Σ the adjustments of each given expense — what to add to its amount for its net. An expense with none
// is absent, which reads as 0.
func adjustedSums(db *gorm.DB, expenseIDs []uint64) (map[uint64]int64, error) {
	out := make(map[uint64]int64, len(expenseIDs))
	if len(expenseIDs) == 0 {
		return out, nil
	}

	var rows []struct {
		AdjustsExpenseID uint64
		Sum              int64
	}

	err := db.
		Model(&expense_service_models.ExpenseRecord{}).
		Select("adjusts_expense_id, COALESCE(SUM(amount), 0) AS sum").
		Where("adjusts_expense_id IN ?", expenseIDs).
		Group("adjusts_expense_id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	for _, r := range rows {
		out[r.AdjustsExpenseID] = r.Sum
	}

	return out, nil
}
