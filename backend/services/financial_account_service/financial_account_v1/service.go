// Package financial_account_v1 implements the money a team actually HOLDS — its bank accounts, its
// ShopeePay wallet and its cash box, each with a balance that moves only with a log row
// (docs/business/financial_account/context_decision.md).
//
// A row arrives two ways and no other (a-row-comes-by-hand-or-from-the-broker): a manager on the account
// screens — opening_balance, transfer, capital, adjustment — or a listener on another service's event —
// withdrawal today, restock, expense and team payment when their events exist (one-way-in-per-type). There
// is no write RPC for other services.
//
// Every write goes through ONE path, `post` in ledger.go: lock the account, append the log row, move the
// balance and fold the day's report row, in one transaction. Nothing else writes a balance.
package financial_account_v1

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1/financial_accountv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_event"
	"github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// ShopChecker answers whether a shop is a live shop of a team — asked of the shop's own service, under the
// caller's token. ShopSet needs it: `shop_id` comes from the request, and without the check one team's admin
// could point another team's shop at their own account and take its withdrawals.
type ShopChecker interface {
	// ShopOfTeam returns nil for a live shop of teamID, and an error otherwise.
	ShopOfTeam(ctx context.Context, teamID, shopID uint64) error
}

type Service struct {
	db    *gorm.DB
	shops ShopChecker
	dedup san_event.EventDedup
	// now is the clock — a picked day is refused when it is after today, in Jakarta.
	now func() time.Time
}

// compile-time proof Service serves both proto services.
var (
	_ financial_accountv1connect.FinancialAccountServiceHandler         = (*Service)(nil)
	_ financial_accountv1connect.FinancialAccountAnalyticServiceHandler = (*Service)(nil)
)

func NewService(db *gorm.DB, shops ShopChecker) *Service {
	// With no shop to ask, every ShopSet is REFUSED rather than trusted.
	if shops == nil {
		shops = noShopChecker{}
	}

	dedup, err := san_event.NewDedup(financial_account_service_models.EventLogTable)
	if err != nil {
		// A constant table name that fails the check is a programming error, not a runtime condition.
		panic(err)
	}

	return &Service{db: db, shops: shops, dedup: dedup, now: time.Now}
}

type noShopChecker struct{}

func (noShopChecker) ShopOfTeam(context.Context, uint64, uint64) error {
	return errors.New("no shop service to ask")
}

// jakarta is the system's calendar (jakarta-is-the-clock). Fixed +7: WIB has no daylight saving.
var jakarta = time.FixedZone("WIB", 7*60*60)

const dateLayout = "2006-01-02"

var (
	errAccountNotFound = connect.NewError(connect.CodeNotFound, errors.New("account not found in this team"))

	errArchived = func(name string) error {
		return connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("%s is archived — restore it first", name))
	}

	errBadDay = connect.NewError(connect.CodeInvalidArgument, errors.New("pick a day, as YYYY-MM-DD"))

	errFutureDay = connect.NewError(connect.CodeInvalidArgument, errors.New("the day cannot be in the future — money cannot have moved tomorrow"))

	errNeedsNumber = connect.NewError(connect.CodeInvalidArgument, errors.New("a bank account or a wallet needs its number"))

	errNoName = connect.NewError(connect.CodeInvalidArgument, errors.New("name the account"))

	errNoAmount = connect.NewError(connect.CodeInvalidArgument, errors.New("type an amount above zero"))

	errOpeningBelowZero = errors.New("an opening balance cannot be below zero")

	errUnknownByHand = connect.NewError(connect.CodeInvalidArgument, errors.New("an unknown account is made only by a withdrawal"))
)

func dbError(err error) error {
	return connect.NewError(connect.CodeInternal, err)
}

// isUniqueViolation detects a duplicate key in BOTH forms — GORM is opened with TranslateError, so the
// driver's 23505 has usually become gorm.ErrDuplicatedKey already (team_service learned this the hard way).
func isUniqueViolation(err error) bool {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}

	return false
}

// actorFrom is who is acting — 0 when the context carries no identity (a direct call, a test). A blank name
// on a real movement beats losing the movement.
func actorFrom(ctx context.Context) uint64 {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return 0
	}

	return identity.GetIdentityId()
}

// today is the Jakarta date now.
func (s *Service) today() string {
	return s.now().In(jakarta).Format(dateLayout)
}

// pickedDay turns a day a person picked into the row's occurred_at (the-log-keeps-the-day-the-money-moved).
//
// Today is NOW — the moment it was typed. An earlier day is that day at noon, Jakarta: unambiguous in
// every zone a reader might be in, and its Jakarta date — the analytics day — is the day picked. A day after
// today is refused: money cannot have moved tomorrow.
func (s *Service) pickedDay(raw string) (time.Time, error) {
	day, err := time.ParseInLocation(dateLayout, strings.TrimSpace(raw), jakarta)
	if err != nil {
		return time.Time{}, errBadDay
	}

	today := s.today()
	picked := day.Format(dateLayout)

	if picked > today {
		return time.Time{}, errFutureDay
	}

	if picked == today {
		return s.now(), nil
	}

	return day.Add(12 * time.Hour), nil
}

// rupiah rounds a figure to whole rupiah as it posts (rupiah-is-floating-point's mitigation), so balances
// compare exactly.
func rupiah(v float64) float64 {
	return math.Round(v)
}

// validAmount is a positive, finite figure — the proto's `gt: 0, finite: true`, re-checked because a handler
// called directly (a test, a CLI) has no validation interceptor in front of it.
func validAmount(v float64) bool {
	return v > 0 && !math.IsInf(v, 0) && !math.IsNaN(v)
}

func totalPages(total int64, limit uint32) uint32 {
	if limit == 0 {
		return 0
	}

	return uint32(math.Ceil(float64(total) / float64(limit)))
}

// pageWindow is a guideline page's limit and offset, defaulting a missing page to the first 20.
func pageWindow(page, limit uint32) (int, int) {
	if limit == 0 {
		limit = 20
	}

	if page == 0 {
		page = 1
	}

	return int(limit), int(page-1) * int(limit)
}
