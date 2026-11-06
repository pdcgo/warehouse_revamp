package expense_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

const teamA uint64 = 2

// The accounts the fake financial_account_service knows, by what each one answers (an-expense-must-name-the-account-that-paid).
const (
	// Team A's active operational account — what every helper pays from. Answered for any team, so a race test's
	// fresh team can pay from it too.
	payingAccount uint64 = 7
	// Archived — its operational mark went with it.
	archivedAccount uint64 = 8
	// Active, but not marked operational.
	plainAccount uint64 = 9
	// Another team's — the fake answers it as absent for team A, as ByIds does.
	otherTeamsAccount uint64 = 10
)

// The shop an ADS expense names in the helpers (an-expense-names-a-shop-only-for-ads).
const adsShop uint64 = 77

type fakeAccounts struct{}

func (fakeAccounts) Account(_ context.Context, teamID, accountID uint64) (expense_v1.PayingAccount, bool, error) {
	switch accountID {
	case payingAccount:
		return expense_v1.PayingAccount{Name: "BCA Operasional", Active: true, Operational: true}, true, nil
	case archivedAccount:
		return expense_v1.PayingAccount{Name: "Mandiri Lama", Active: false, Operational: false}, true, nil
	case plainAccount:
		return expense_v1.PayingAccount{Name: "Tabungan Pemilik", Active: true, Operational: false}, true, nil
	case otherTeamsAccount:
		if teamID == teamA {
			return expense_v1.PayingAccount{}, false, nil
		}

		return expense_v1.PayingAccount{Name: "Their BCA", Active: true, Operational: true}, true, nil
	}

	return expense_v1.PayingAccount{}, false, nil
}

// The warehouse team of the expense tests — every other team is a seller (the-warehouse-is-its-own-group).
const warehouseTeam uint64 = 11

// fakeSides is team_service's answer: warehouseTeam is a warehouse, the root team neither, every other team a seller.
type fakeSides struct{}

func (fakeSides) SideOf(_ context.Context, teamID uint64) (expense_v1.TeamSide, error) {
	switch teamID {
	case warehouseTeam:
		return expense_v1.SideWarehouse, nil
	case 1:
		return expense_v1.SideNeither, nil
	default:
		return expense_v1.SideSeller, nil
	}
}

func newService(t *testing.T, db *gorm.DB) *expense_v1.Service {
	t.Helper()

	return expense_v1.NewService(db, nil, fakeAccounts{}, fakeSides{})
}

// sentEvents records what the service published, in order.
type sentEvents struct {
	events []*eventsv1.Event
	fail   error
}

func (s *sentEvents) send(_ context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
	s.events = append(s.events, event)

	return s.fail
}

func newServiceSending(t *testing.T, db *gorm.DB, sent *sentEvents) *expense_v1.Service {
	t.Helper()

	return expense_v1.NewService(db, sent.send, fakeAccounts{}, fakeSides{})
}

// shopFor is the shop a helper's expense names: ADS names one, every other kind none.
func shopFor(kind expensev1.ExpenseKind) uint64 {
	if kind == expensev1.ExpenseKind_EXPENSE_KIND_ADS {
		return adsShop
	}

	return 0
}

func page1() *commonv1.CommonPagination {
	return &commonv1.CommonPagination{Page: 1, Limit: 50}
}

// expenseRows pulls the EXPENSE (row) slice out of a list response, in the response's sorted id order.
// The handler defaults an empty data_request to the EXPENSE slice, so tests that don't set one get it.
func expenseRows(res *expensev1.ExpenseListResponse) []*expensev1.ExpenseRowItem {
	var rowMap map[uint64]*expensev1.ExpenseRowItem

	for _, it := range res.GetItems() {
		e := it.GetExpense()
		if e != nil {
			rowMap = e.GetMapData()
		}
	}

	out := make([]*expensev1.ExpenseRowItem, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		r, ok := rowMap[id]
		if ok {
			out = append(out, r)
		}
	}

	return out
}

// record enters one cost, so a test reads as the money it is describing rather than as message
// construction.
func record(
	t *testing.T,
	svc *expense_v1.Service,
	kind expensev1.ExpenseKind,
	amount float64,
	on string,
) *expensev1.ExpenseRecord {
	t.Helper()

	res, err := svc.ExpenseCreate(context.Background(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId: teamA, Kind: kind, Amount: amount, OccurredAt: on, ShopId: shopFor(kind), FinanceAccountId: payingAccount,
	}))
	if err != nil {
		t.Fatalf("ExpenseCreate(%v, %v, %s): %v", kind, amount, on, err)
	}

	return res.Msg.GetExpense()
}
