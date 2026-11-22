package financial_account_v1_test

import (
	"context"
	"strconv"
	"testing"

	"connectrpc.com/connect"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// CAPITAL'S SECOND DOOR (prive-and-deposit-on-pengeluaran-are-the-accounts-capital): Setor / Tarik Modal still posts
// its one by-hand `capital` row at once — and, after the commit, tells the broker (FinancialAccountCapitalRecorded) so
// expense_service can show a selling team's on Biaya. This service knows no team types: every team's is told; the
// expense side drops a warehouse team's (expense_v1/capital_from_account_test.go).

type capitalSent struct{ events []*eventsv1.Event }

const (
	kOtherKind = expensev1.ExpenseKind_EXPENSE_KIND_OTHER
	tPriveType = expensev1.ExpenseType_EXPENSE_TYPE_PRIVE
)

func formatID(id uint64) string {
	return strconv.FormatUint(id, 10)
}

func (s *capitalSent) send(_ context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
	s.events = append(s.events, event)

	return nil
}

func capitalOf(t *testing.T, svc *financial_account_v1.Service, ctx context.Context, team, account uint64,
	direction financial_accountv1.CapitalDirection, amount float64, on, note string,
) *financial_accountv1.FinancialAccountLog {
	t.Helper()

	resp, err := svc.FinancialAccountCapital(ctx, connect.NewRequest(&financial_accountv1.FinancialAccountCapitalRequest{
		TeamId: team, AccountId: account, Direction: direction, Amount: amount, OccurredOn: on, Note: note,
	}))
	if err != nil {
		t.Fatalf("capital: %v", err)
	}

	return resp.Msg.GetLog()
}

// THE ACCOUNT ROW IS AS IT ALWAYS WAS — one by-hand capital row, signed by the direction, described *Capital in — note*,
// no expense named (the history's *manual · who*) — and its message carries exactly that row: its id, team, account,
// signed change, Jakarta day, the note back out of the description, who and the override mark, its time.
func TestFinancialAccountCapital_TellsTheBrokerItsRow(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &capitalSent{}
	svc := financial_account_v1.NewService(db, testShops, nil, sent.send)

	a := mustCreate(t, svc, bca(teamA, "BCA", "9100000001", 1_000))

	in := capitalOf(t, svc, asAni(), teamA, a.GetId(), financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_IN, 500, day(1), "top-up")
	// Root from outside the team: a scope, no role — the override mark.
	root := san_auth.WithScope(asAni(), teamA)
	out := capitalOf(t, svc, root, teamA, a.GetId(), financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_OUT, 200, day(0), "  ")

	if in.GetDescription() != "Capital in — top-up" || out.GetDescription() != "Capital out" || in.GetExpenseId() != 0 {
		t.Fatalf("the rows: %+v / %+v", in, out)
	}

	capital := []m.FinancialAccountLog{}
	for _, row := range logs(t, db, a.GetId()) {
		if row.ChangeType == m.ChangeCapital {
			capital = append(capital, row)
		}
	}

	if len(capital) != 2 || capital[0].ExpenseID != 0 || capital[1].ExpenseID != 0 {
		t.Fatalf("capital rows %+v — want two by hand, naming no expense", capital)
	}

	if balance(t, db, a.GetId()) != 1_300 {
		t.Fatalf("balance %v — the money moves at once, as always", balance(t, db, a.GetId()))
	}

	if len(sent.events) != 2 {
		t.Fatalf("%d events — want one per act", len(sent.events))
	}

	for i, c := range []struct {
		log      *financial_accountv1.FinancialAccountLog
		change   float64
		on       string
		note     string
		override bool
	}{
		{in, 500, day(1), "top-up", false},
		{out, -200, day(0), "", true},
	} {
		event := sent.events[i]
		got := event.GetFinancialAccountCapitalRecorded()

		if got == nil || event.GetEventId() != "financial-account-capital:"+formatID(c.log.GetId()) {
			t.Fatalf("event %d: %v", i, event)
		}

		if got.GetLogId() != c.log.GetId() || got.GetTeamId() != teamA || got.GetAccountId() != a.GetId() ||
			got.GetChange() != c.change || got.GetOccurredOn() != c.on || got.GetNote() != c.note ||
			got.GetActorId() != ani || got.GetActorIsOverride() != c.override || got.GetCreatedAtUnix() == 0 {
			t.Fatalf("event %d carries %+v", i, got)
		}
	}
}

// A REFUSED Setor / Tarik Modal (an archived account) posts nothing and tells nothing.
func TestFinancialAccountCapital_ARefusalTellsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &capitalSent{}
	svc := financial_account_v1.NewService(db, testShops, nil, sent.send)

	a := mustCreate(t, svc, cash(teamA, "Kas", 0))

	err := db.
		Model(&m.FinancialAccount{}).
		Where("id = ?", a.GetId()).
		Update("status", m.StatusArchived).
		Error
	if err != nil {
		t.Fatalf("archive: %v", err)
	}

	_, err = svc.FinancialAccountCapital(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountCapitalRequest{
		TeamId: teamA, AccountId: a.GetId(), Direction: financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_IN,
		Amount: 10, OccurredOn: day(0),
	}))
	if code := connectCode(t, err); code != connect.CodeFailedPrecondition {
		t.Fatalf("archived: code = %v", code)
	}

	if len(sent.events) != 0 {
		t.Fatalf("a refusal published %d events", len(sent.events))
	}
}

// THE IMPORT'S READ (`san expense import-capital`): only by-hand capital rows — never one the expense listener posted
// from Biaya (`expense_id` set), never another type — every team's, oldest first, paged by id; each the very message the
// door publishes.
func TestHandCapitalEvents_ReadsOnlyTheByHandCapitalRows(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := mustCreate(t, svc, bca(teamA, "BCA", "9100000002", 0))
	b := mustCreate(t, svc, cash(teamB, "Kas B", 0))

	first := capitalOf(t, svc, asAni(), teamA, a.GetId(), financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_IN, 1_000_000, day(3), "modal awal")
	second := capitalOf(t, svc, asAni(), teamB, b.GetId(), financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_OUT, 50_000, day(2), "")

	// A Prive typed on Biaya, posted by the expense listener, and an expense — not account-page capital.
	err := svc.ExpensePaymentHandler()(context.Background(), typedCreated("expense-created:77001", a.GetId(), kOtherKind, tPriveType, 300_000))
	if err != nil {
		t.Fatalf("post a Biaya prive: %v", err)
	}

	err = svc.ExpensePaymentHandler()(context.Background(), expenseCreated("expense-created:77002", a.GetId(), kOtherKind, 25_000))
	if err != nil {
		t.Fatalf("post an expense: %v", err)
	}

	floor := first.GetId() - 1

	all, err := financial_account_v1.HandCapitalEvents(db, floor, 100)
	if err != nil {
		t.Fatalf("HandCapitalEvents: %v", err)
	}

	if len(all) != 2 {
		t.Fatalf("%d rows — want the two by-hand capital rows", len(all))
	}

	got := all[0].GetFinancialAccountCapitalRecorded()
	if got.GetLogId() != first.GetId() || got.GetTeamId() != teamA || got.GetChange() != 1_000_000 ||
		got.GetNote() != "modal awal" || got.GetOccurredOn() != day(3) || got.GetActorId() != ani {
		t.Fatalf("first: %+v", got)
	}

	if all[1].GetFinancialAccountCapitalRecorded().GetLogId() != second.GetId() || all[1].GetFinancialAccountCapitalRecorded().GetChange() != -50_000 {
		t.Fatalf("second: %+v", all[1].GetFinancialAccountCapitalRecorded())
	}

	page, err := financial_account_v1.HandCapitalEvents(db, floor, 1)
	if err != nil {
		t.Fatalf("HandCapitalEvents page: %v", err)
	}

	next, err := financial_account_v1.HandCapitalEvents(db, page[0].GetFinancialAccountCapitalRecorded().GetLogId(), 1)
	if err != nil {
		t.Fatalf("HandCapitalEvents next: %v", err)
	}

	if len(page) != 1 || len(next) != 1 || next[0].GetFinancialAccountCapitalRecorded().GetLogId() != second.GetId() {
		t.Fatalf("paging read %v then %v", page, next)
	}
}
