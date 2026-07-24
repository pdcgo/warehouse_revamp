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

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1/expensev1connect"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

type Service struct {
	db *gorm.DB
}

// compile-time proof Service satisfies the generated handler interface.
var _ expensev1connect.ExpenseServiceHandler = (*Service)(nil)

func NewService(db *gorm.DB) *Service {
	return &Service{db: db}
}

// The date layout every cost date crosses the wire in. A DATE, not a timestamp: nobody records the
// hour the rent was paid, and a timestamp would invite a timezone question that has no answer here.
const dateLayout = "2006-01-02"

var errBadDate = errors.New("a date must be YYYY-MM-DD")

func costErr(err error) error {
	switch {
	case errors.Is(err, errBadDate):
		return connect.NewError(connect.CodeInvalidArgument, errBadDate)
	case errors.Is(err, gorm.ErrRecordNotFound):
		// NotFound, never PermissionDenied: another team's cost must be indistinguishable from one that
		// does not exist, or the error itself confirms the id.
		return connect.NewError(connect.CodeNotFound, errCostMissing)
	case errors.Is(err, errCostVoided):
		return connect.NewError(connect.CodeFailedPrecondition, errCostVoided)
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

func costToProto(c *expense_service_models.ExpenseRecord) *expensev1.ExpenseRecord {
	return &expensev1.ExpenseRecord{
		Id:            c.ID,
		TeamId:        c.TeamID,
		ShopId:        c.ShopID,
		Kind:          expensev1.ExpenseKind(c.Kind),
		Amount:        c.Amount,
		OccurredAt:    c.OccurredAt.Format(dateLayout),
		Note:          c.Note,
		CreatedBy:     c.CreatedBy,
		Voided:        c.VoidedAt != nil,
		CreatedAtUnix: c.CreatedAt.Unix(),
	}
}
