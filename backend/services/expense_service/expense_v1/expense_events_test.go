package expense_v1_test

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

// THE EXPENSE'S MONEY EVENTS (an-expense-must-name-the-account-that-paid, a-correction-follows-the-expenses-account):
// recorded, and each correction — published once each, after its commit, for whoever posts the account.

// Recorded: one ExpenseCreated, its id derived from the expense, carrying the account, the kind, the amount and the day.
func TestExpenseEvents_CreateAnnouncesTheAccountThatPaid(t *testing.T) {
	sent := &sentEvents{}
	svc := newServiceSending(t, san_testdb.DB(t), sent)

	ads := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 2_000_000, "2026-09-28")

	if len(sent.events) != 1 {
		t.Fatalf("%d events after one expense, want 1", len(sent.events))
	}

	if want := "expense-created:" + strconv.FormatUint(ads.GetId(), 10); sent.events[0].GetEventId() != want {
		t.Fatalf("event id %q, want %q — derived, so a republish dedups", sent.events[0].GetEventId(), want)
	}

	got := sent.events[0].GetExpenseCreated()
	if got == nil || got.GetExpenseId() != ads.GetId() || got.GetTeamId() != teamA ||
		got.GetKind() != expensev1.ExpenseKind_EXPENSE_KIND_ADS || got.GetFinanceAccountId() != payingAccount ||
		got.GetAmount() != 2_000_000 || got.GetOccurredOn() != "2026-09-28" || got.GetShopId() != adsShop {
		t.Fatalf("ExpenseCreated = %+v, want expense %d, team %d, ADS, account %d, 2000000 on 2026-09-28, shop %d",
			got, ads.GetId(), teamA, payingAccount, adsShop)
	}
}

// Each correction: one ExpenseAdjusted per adjustment row, naming the EXPENSE's account (copied, never typed), signed —
// and Batalkan is just a correction of minus the net.
func TestExpenseEvents_EachCorrectionAnnouncesItsSignedAmount(t *testing.T) {
	sent := &sentEvents{}
	svc := newServiceSending(t, san_testdb.DB(t), sent)

	expense := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 5_000_000, "2026-09-28")
	down := adjust(t, svc, expense.GetId(), -4_500_000).GetAdjustment()
	up := adjust(t, svc, expense.GetId(), 1_000_000).GetAdjustment()
	cancel := adjust(t, svc, expense.GetId(), -1_500_000).GetAdjustment()

	if len(sent.events) != 4 {
		t.Fatalf("%d events, want 4 — the expense and its three corrections", len(sent.events))
	}

	for i, want := range []struct {
		row    uint64
		amount float64
	}{{down.GetId(), -4_500_000}, {up.GetId(), 1_000_000}, {cancel.GetId(), -1_500_000}} {
		event := sent.events[i+1]
		if id := "expense-adjusted:" + strconv.FormatUint(want.row, 10); event.GetEventId() != id {
			t.Fatalf("correction %d: event id %q, want %q", i, event.GetEventId(), id)
		}

		got := event.GetExpenseAdjusted()
		if got == nil || got.GetAdjustmentId() != want.row || got.GetExpenseId() != expense.GetId() ||
			got.GetFinanceAccountId() != payingAccount || got.GetAmount() != want.amount ||
			got.GetKind() != expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL || got.GetOccurredOn() != "2026-09-28" {
			t.Fatalf("correction %v: ExpenseAdjusted = %+v, want adjustment %v of expense %v, account %v, %v",
				i, got, want.row, expense.GetId(), payingAccount, want.amount)
		}
	}
}

// The adjustment row itself carries the expense's account — a-correction-follows-the-expenses-account.
func TestExpenseAdjust_CopiesTheExpensesAccount(t *testing.T) {
	svc := newService(t, san_testdb.DB(t))

	expense := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL, 300_000, "2026-09-28")
	res := adjust(t, svc, expense.GetId(), -100_000)

	if res.GetAdjustment().GetFinanceAccountId() != payingAccount || res.GetExpense().GetFinanceAccountId() != payingAccount {
		t.Fatalf("adjustment names account %d, expense %d — want both %d",
			res.GetAdjustment().GetFinanceAccountId(), res.GetExpense().GetFinanceAccountId(), payingAccount)
	}
}

// Nothing is published for what moves no account: a STOCK_LOSS (no cash moved), and an expense made before *Paid
// from* (account 0) — nor for its corrections.
func TestExpenseEvents_NothingForStockLossOrAnOldExpense(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &sentEvents{}
	svc := newServiceSending(t, db, sent)
	ctx := context.Background()

	loss, err := svc.ExpenseCreate(ctx, connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId: teamA, Kind: expensev1.ExpenseKind_EXPENSE_KIND_STOCK_LOSS, Amount: 30_000, OccurredAt: "2026-09-28",
	}))
	if err != nil {
		t.Fatalf("stock loss: %v", err)
	}

	adjust(t, svc, loss.Msg.GetExpense().GetId(), -10_000)

	// An expense from before *Paid from*: stored with account 0, as the migration left every old row.
	old := expense_service_models.ExpenseRecord{
		TeamID: teamA, Kind: int32(expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL), Amount: 1_000_000,
		OccurredAt: time.Date(2026, 9, 28, 0, 0, 0, 0, time.UTC), CreatedBy: 1,
	}

	err = db.Create(&old).Error
	if err != nil {
		t.Fatalf("seed an old expense: %v", err)
	}

	res := adjust(t, svc, old.ID, -1_000_000)
	if res.GetAdjustment().GetFinanceAccountId() != 0 {
		t.Fatalf("an old expense's correction names account %d, want 0", res.GetAdjustment().GetFinanceAccountId())
	}

	if len(sent.events) != 0 {
		t.Fatalf("%d events for a stock loss and an old expense, want none: %v", len(sent.events), sent.events)
	}
}

// A failed publish never fails the expense that already committed (no-outbox-the-publish-is-trusted) — it is logged
// with its event_id, and the row stands.
func TestExpenseEvents_AFailedPublishKeepsTheExpense(t *testing.T) {
	sent := &sentEvents{fail: errors.New("broker down")}
	svc := newServiceSending(t, san_testdb.DB(t), sent)

	got := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_OTHER, 75_000, "2026-09-28")
	if got.GetId() == 0 || len(sent.events) != 1 {
		t.Fatalf("expense %v with %d publish attempts, want it stored after one attempt", got, len(sent.events))
	}

	adjust(t, svc, got.GetId(), -75_000)

	if len(sent.events) != 2 {
		t.Fatalf("%d publish attempts, want 2", len(sent.events))
	}
}
