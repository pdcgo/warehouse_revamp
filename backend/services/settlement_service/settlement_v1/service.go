// Package settlement_v1 implements the ledger of WHAT THE MARKETPLACE PAYS US for an order.
//
// ⚠ NOT `liability_service`, which is what TEAMS OWE EACH OTHER. That service held this name until it
// was renamed to make room for this one, and the two are still easy to confuse: both are order-aware
// ledgers with a state projection. The difference is who the counterparty is — a marketplace here, a
// team there — and only this one is allowed to never balance.
//
// THE ONE IDEA. `initial_total` is a frozen copy of `order.marketplace_total`: what the buyer actually
// paid, a FACT. The running balance is therefore not drift from a guess, it is exactly how much of
// what the buyer paid never reached us — the platform's take, which the platform never itemises.
//
// ⚠ THE BALANCE NEVER REACHES ZERO AND MUST NOT BE PRESENTED AS IF IT SHOULD. There is no `settled`
// flag and no outstanding figure anywhere in this package.
package settlement_v1

import (
	"context"
	"errors"
	"math"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1/settlementv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

type Service struct {
	db *gorm.DB
}

// compile-time proof Service serves both proto services. One implementation behind two, exactly as
// liability_v1 and selling_v1 do — the split is about WHEN each can be mounted, not about taste.
var (
	_ settlementv1connect.SettlementServiceHandler      = (*Service)(nil)
	_ settlementv1connect.SettlementWriteServiceHandler = (*Service)(nil)
)

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

const dateLayout = "2006-01-02"

// dbError keeps the mapping in one place, as every other service here does.
func dbError(err error) error {
	return connect.NewError(connect.CodeInternal, err)
}

var (
	errBadDate = connect.NewError(connect.CodeInvalidArgument, errors.New("date must be YYYY-MM-DD"))

	// ⚠ THE ONE RULE THE DATA ENFORCES. A cancel zeroes the sale of an order the order service still
	// believes is live, so a person must never be able to post one — the legitimate human need ("the
	// sale figure is wrong") is served by reverse-then-repost instead.
	errCancelNotMachine = connect.NewError(
		connect.CodePermissionDenied,
		errors.New("initial_total_cancel may only be posted by order_service"),
	)

	errWrongTeam = connect.NewError(
		connect.CodePermissionDenied,
		errors.New("this order's settlement belongs to another team"),
	)

	errNoAccount = connect.NewError(
		connect.CodeNotFound,
		errors.New("this order has no settlement account"),
	)

	// The shop is frozen onto the account by the FIRST post. A later post naming a different one is
	// not a shop change — an order does not move between shops — it is a caller with the wrong order.
	errWrongShop = connect.NewError(
		connect.CodeInvalidArgument,
		errors.New("this order's settlement belongs to another shop"),
	)

	// A reversal points backwards at a row of the same order. An append-only ledger cannot repair a
	// dangling pointer later, so it is refused at write time.
	errReversesUnknown = connect.NewError(
		connect.CodeInvalidArgument,
		errors.New("reverses_id names no entry on this order"),
	)

	errUnknownType   = errors.New("unknown settlement_type")
	errUnknownSource = errors.New("unknown source_type")
)

// parseDate is deliberate about its error: the proto's regex has already run in production, but a
// handler called directly (a CLI command, a unit test) has no validation interceptor in front of it.
func parseDate(raw string) (time.Time, error) {
	t, err := time.Parse(dateLayout, raw)
	if err != nil {
		return time.Time{}, errBadDate
	}

	return t, nil
}

// actorFrom pulls the acting user's id from the request identity.
//
// 0 if somehow absent. The row records WHO, but a missing actor must not fail a settlement figure
// somebody is trying to record — a blank name on a real number beats losing the number. Same
// judgement as expense_service.
func actorFrom(ctx context.Context) uint64 {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return 0
	}

	return identity.GetIdentityId()
}

func totalPages(total int64, limit uint32) uint32 {
	if limit == 0 {
		return 0
	}

	return uint32(math.Ceil(float64(total) / float64(limit)))
}
