package expense_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

// asCaller is a request context as the access interceptor leaves it: who is calling, the team the call is scoped to,
// and their role there. ROLE_UNSPECIFIED is Root or the Administrator, in by the root-team bypass.
func asCaller(userID, scope uint64, role role_basev1.Role) context.Context {
	ctx := san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: userID})
	ctx = san_auth.WithScope(ctx, scope)

	return san_auth.WithCallerRole(ctx, role)
}

func storedOverride(t *testing.T, db *gorm.DB, id uint64) bool {
	t.Helper()

	var row expense_service_models.ExpenseRecord

	err := db.First(&row, id).Error
	if err != nil {
		t.Fatalf("read expense %d: %v", id, err)
	}

	return row.IsOverride
}

// AN OVERRIDE IS STAMPED (an-override-is-stamped-in-every-service): an expense and an adjustment typed by Root from
// outside the team say so; the same writes by the team's own owner do not. Each row carries its OWN typist's answer —
// a member correcting Root's expense writes an adjustment that is not an override.
func TestExpenseOverride_EachRowCarriesItsTypist(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	root := asCaller(1, teamA, role_basev1.Role_ROLE_UNSPECIFIED)
	owner := asCaller(42, teamA, role_basev1.Role_ROLE_SELLING_OWNER)

	create := func(ctx context.Context) uint64 {
		res, err := svc.ExpenseCreate(ctx, connect.NewRequest(&expensev1.ExpenseCreateRequest{
			TeamId: teamA, Kind: expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, Amount: 5_000_000, OccurredAt: "2026-09-28",
			FinanceAccountId: payingAccount,
		}))
		if err != nil {
			t.Fatalf("ExpenseCreate: %v", err)
		}

		return res.Msg.GetExpense().GetId()
	}

	adjustAs := func(ctx context.Context, expenseID uint64) uint64 {
		res, err := svc.ExpenseAdjust(ctx, connect.NewRequest(&expensev1.ExpenseAdjustRequest{
			TeamId: teamA, ExpenseId: expenseID, Amount: -1_000_000, Note: "typo",
		}))
		if err != nil {
			t.Fatalf("ExpenseAdjust: %v", err)
		}

		return res.Msg.GetAdjustment().GetId()
	}

	byRoot := create(root)
	byOwner := create(owner)
	ownerFixesRoot := adjustAs(owner, byRoot)
	rootFixesOwner := adjustAs(root, byOwner)

	cases := []struct {
		name string
		id   uint64
		want bool
	}{
		{"Root's expense", byRoot, true},
		{"the owner's expense", byOwner, false},
		{"the owner's adjustment of Root's expense", ownerFixesRoot, false},
		{"Root's adjustment of the owner's expense", rootFixesOwner, true},
	}

	for _, c := range cases {
		got := storedOverride(t, db, c.id)
		if got != c.want {
			t.Errorf("%s: is_override = %v, want %v", c.name, got, c.want)
		}
	}
}

// rootOutside is Root, in by the root-team bypass, inside a team it holds no role in; ownerIn is that team's own owner.
func rootOutside(scope uint64) context.Context {
	return asCaller(1, scope, role_basev1.Role_ROLE_UNSPECIFIED)
}

func ownerIn(scope uint64) context.Context {
	return asCaller(42, scope, role_basev1.Role_ROLE_SELLING_OWNER)
}
