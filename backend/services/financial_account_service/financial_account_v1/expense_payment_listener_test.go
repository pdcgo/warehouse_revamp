package financial_account_v1_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// THE EXPENSE'S PAYMENT (an-expense-must-name-the-account-that-paid, a-correction-follows-the-expenses-account,
// ads-expense-joins-the-types): expense_service's ExpenseCreated and ExpenseAdjusted, posted on the account that paid.

const expenseID uint64 = 8_801

// spentOn is the day the expense belongs to — three days back, so the row's day is not today by accident.
var spentOn = day(3)

func expenseCreated(eventID string, account uint64, kind expensev1.ExpenseKind, amount int64) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     eventID,
		OccurredAt:  timestamppb.Now(),
		AggregateId: "expense:8801",
		Message: &eventsv1.Event_ExpenseCreated{ExpenseCreated: &eventsv1.ExpenseCreated{
			ExpenseId: expenseID, TeamId: teamA, Kind: kind, FinanceAccountId: account, Amount: amount,
			OccurredOn: spentOn, ActorId: ani, CreatedAtUnix: time.Now().Unix(),
		}},
	}
}

func expenseAdjusted(eventID string, account uint64, kind expensev1.ExpenseKind, amount int64) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     eventID,
		OccurredAt:  timestamppb.Now(),
		AggregateId: "expense:8801",
		Message: &eventsv1.Event_ExpenseAdjusted{ExpenseAdjusted: &eventsv1.ExpenseAdjusted{
			AdjustmentId: 8_802, ExpenseId: expenseID, TeamId: teamA, Kind: kind, FinanceAccountId: account,
			Amount: amount, OccurredOn: spentOn, ActorId: ani, ActorIsOverride: true, CreatedAtUnix: time.Now().Unix(),
		}},
	}
}

func payExpense(svc *financial_account_v1.Service, event *eventsv1.Event) error {
	return svc.ExpensePaymentHandler()(context.Background(), event)
}

func mustPayExpense(t *testing.T, svc *financial_account_v1.Service, event *eventsv1.Event) {
	t.Helper()

	err := payExpense(svc, event)
	if err != nil {
		t.Fatalf("deliver %s: %v", event.GetEventId(), err)
	}
}

// rowsOfType is every row of one change type on an account, in entry order.
func rowsOfType(t *testing.T, db *gorm.DB, account uint64, changeType string) []m.FinancialAccountLog {
	t.Helper()

	out := []m.FinancialAccountLog{}
	for _, row := range logs(t, db, account) {
		if row.ChangeType == changeType {
			out = append(out, row)
		}
	}

	return out
}

// reportOn is the account's daily report row for one day, nil when there is none.
func reportOn(t *testing.T, db *gorm.DB, account uint64, on string) *m.FinancialAccountDailyReport {
	t.Helper()

	for _, d := range daily(t, db, account) {
		if d.Day.Format("2006-01-02") == on {
			return &d
		}
	}

	return nil
}

// An OPERATIONAL expense leaves the account as ONE `expense` row, on the expense's own day, naming it and its typist;
// the day's report carries it in the `expense` column.
func TestExpensePayment_CreatedPostsAnExpenseOutOfTheAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	mustPayExpense(t, svc, expenseCreated("expense-created:8801", bcaA.GetId(), expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL, 150_000))

	if got := balance(t, db, bcaA.GetId()); got != 850_000 {
		t.Fatalf("balance = %v, want 850000", got)
	}

	rows := rowsOfType(t, db, bcaA.GetId(), m.ChangeExpense)
	if len(rows) != 1 || rows[0].Change != -150_000 || rows[0].Description != "Expense E-8801" || rows[0].ActorID != ani {
		t.Fatalf("expense rows = %+v, want one −150000 \"Expense E-8801\" by %d", rows, ani)
	}

	if got := rows[0].OccurredAt.In(jakarta).Format("2006-01-02"); got != spentOn {
		t.Fatalf("the row counts on %s, want the expense's day %s", got, spentOn)
	}

	report := reportOn(t, db, bcaA.GetId(), spentOn)
	if report == nil || report.Expense != -150_000 || report.AdsExpense != 0 {
		t.Fatalf("the day's report row = %+v, want expense −150000", report)
	}
}

// ads-expense-joins-the-types: an ADS expense posts as `ads_expense`, in its own report column.
func TestExpensePayment_AdsPostsAsAdsExpense(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	mustPayExpense(t, svc, expenseCreated("expense-created:8801", bcaA.GetId(), expensev1.ExpenseKind_EXPENSE_KIND_ADS, 200_000))

	if rows := rowsOfType(t, db, bcaA.GetId(), m.ChangeAdsExpense); len(rows) != 1 || rows[0].Change != -200_000 {
		t.Fatalf("ads_expense rows = %+v, want one −200000", rows)
	}

	if rows := rowsOfType(t, db, bcaA.GetId(), m.ChangeExpense); len(rows) != 0 {
		t.Fatalf("an ads expense posted %d `expense` rows, want none", len(rows))
	}

	report := reportOn(t, db, bcaA.GetId(), spentOn)
	if report == nil || report.AdsExpense != -200_000 || report.Expense != 0 {
		t.Fatalf("the day's report row = %+v, want ads_expense −200000", report)
	}
}

// one-contract-for-both-handler-types: a redelivered expense posts ONCE.
func TestExpensePayment_ARedeliveryPostsOnce(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	event := expenseCreated("expense-created:8801", bcaA.GetId(), expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 300_000)
	mustPayExpense(t, svc, event)
	mustPayExpense(t, svc, event)

	if got := balance(t, db, bcaA.GetId()); got != 700_000 {
		t.Fatalf("balance = %v after a redelivery, want 700000 — paid once", got)
	}
}

// a-correction-follows-the-expenses-account: a correction posts its SIGNED difference on the expense's account — down
// gives money back, up takes more — and Batalkan (minus the net) brings the account back to where it started.
func TestExpensePayment_CorrectionsPostTheirDifference(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	ads := expensev1.ExpenseKind_EXPENSE_KIND_ADS
	mustPayExpense(t, svc, expenseCreated("expense-created:8801", bcaA.GetId(), ads, 500_000))

	steps := []struct {
		eventID string
		amount  int64
		want    float64
	}{
		{"expense-adjusted:1", -450_000, 950_000},  // a typo: 500.000 was 50.000 — 450.000 back
		{"expense-adjusted:2", 30_000, 920_000},    // 30.000 more was spent
		{"expense-adjusted:3", -80_000, 1_000_000}, // Batalkan — minus the net, the whole of it back
	}

	for _, step := range steps {
		mustPayExpense(t, svc, expenseAdjusted(step.eventID, bcaA.GetId(), ads, step.amount))

		if got := balance(t, db, bcaA.GetId()); got != step.want {
			t.Fatalf("after %s (%d): balance = %v, want %v", step.eventID, step.amount, got, step.want)
		}
	}

	rows := rowsOfType(t, db, bcaA.GetId(), m.ChangeAdsExpense)
	if len(rows) != 4 || rows[1].Description != "Expense E-8801 adjusted" || !rows[1].IsOverride {
		t.Fatalf("ads_expense rows = %+v, want the expense and three \"Expense E-8801 adjusted\" rows, the override stamped", rows)
	}

	// Every correction counts on the expense's day, so that day nets to 0.
	report := reportOn(t, db, bcaA.GetId(), spentOn)
	if report == nil || report.AdsExpense != 0 {
		t.Fatalf("the expense's day = %+v, want ads_expense 0 once cancelled", report)
	}
}

// An expense with no account (made before *Paid from*, and its corrections) and a STOCK_LOSS post NOTHING — and are
// claimed, so a redelivery is answered by the claim.
func TestExpensePayment_NoAccountOrStockLossPostsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	mustPayExpense(t, svc, expenseCreated("expense-created:1", 0, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 100_000))
	mustPayExpense(t, svc, expenseAdjusted("expense-adjusted:1", 0, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, -100_000))
	mustPayExpense(t, svc, expenseCreated("expense-created:2", bcaA.GetId(), expensev1.ExpenseKind_EXPENSE_KIND_STOCK_LOSS, 40_000))

	if got := balance(t, db, bcaA.GetId()); got != 1_000_000 {
		t.Fatalf("balance = %v, want untouched 1000000", got)
	}

	for _, id := range []string{"expense-created:1", "expense-adjusted:1", "expense-created:2"} {
		if !claimed(t, db, id) {
			t.Fatalf("%s was not claimed", id)
		}
	}
}

// An account that is not the expense team's, or does not exist, is refused and NOT claimed — a dead letter, never money
// filed somewhere else. An ARCHIVED account still posts: refusing would dead-letter money that moved.
func TestExpensePayment_AWrongAccountIsRefusedAnArchivedOnePosts(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	theirs := mustCreate(t, svc, bca(teamB, "BCA Gudang", "9600000022", 1_000_000))
	mine := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 0))

	err := payExpense(svc, expenseCreated("expense-created:1", theirs.GetId(), expensev1.ExpenseKind_EXPENSE_KIND_OTHER, 10_000))
	if err == nil || !strings.Contains(err.Error(), "not team") {
		t.Fatalf("another team's account = %v, want refused", err)
	}

	err = payExpense(svc, expenseCreated("expense-created:2", 999_999, expensev1.ExpenseKind_EXPENSE_KIND_OTHER, 10_000))
	if err == nil {
		t.Fatal("a missing account was accepted")
	}

	if claimed(t, db, "expense-created:1") || claimed(t, db, "expense-created:2") {
		t.Fatal("a refused event was claimed — its redelivery would never retry")
	}

	err = db.Model(&m.FinancialAccount{}).Where("id = ?", mine.GetId()).Update("status", m.StatusArchived).Error
	if err != nil {
		t.Fatalf("archive: %v", err)
	}

	mustPayExpense(t, svc, expenseAdjusted("expense-adjusted:9", mine.GetId(), expensev1.ExpenseKind_EXPENSE_KIND_OTHER, -25_000))

	if got := balance(t, db, mine.GetId()); got != 25_000 {
		t.Fatalf("archived account = %v, want 25000 back", got)
	}
}

// Every event carries its own delta, so a correction delivered before its expense ends at the same balance.
func TestExpensePayment_OutOfOrderDeliveryEndsTheSame(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	bcaA := mustCreate(t, svc, bca(teamA, "BCA Ops", "9600000011", 1_000_000))

	payroll := expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL
	mustPayExpense(t, svc, expenseAdjusted("expense-adjusted:1", bcaA.GetId(), payroll, -100_000))
	mustPayExpense(t, svc, expenseCreated("expense-created:8801", bcaA.GetId(), payroll, 400_000))

	if got := balance(t, db, bcaA.GetId()); got != 700_000 {
		t.Fatalf("balance = %v, want 700000 — 400000 out, 100000 back", got)
	}
}
