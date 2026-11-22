package expense_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// CAPITAL'S SECOND DOOR (prive-and-deposit-on-pengeluaran-are-the-accounts-capital — one act, one record, two doors;
// the-expense-types-prototype-is-accepted, its *as drawn* table's old rows; acceptance financial_account/expense.md givens
// 18–19): a SELLING team's Setor / Tarik Modal on the account page, heard from the account's
// FinancialAccountCapitalRecorded, is ONE Biaya row — Setoran modal / Prive, origin ACCOUNT_PAGE, linked to the account
// row — and nothing is published back.

const recordedBy uint64 = 61

// capitalEvent is the account's message for one by-hand capital row, as financial_account_v1 builds it.
func capitalEvent(logID, team, account uint64, change float64, on, note string, override bool) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     fmt.Sprintf("financial-account-capital:%d", logID),
		OccurredAt:  timestamppb.New(mustDay(on)),
		AggregateId: fmt.Sprintf("financial-account:%d", account),
		Message: &eventsv1.Event_FinancialAccountCapitalRecorded{FinancialAccountCapitalRecorded: &eventsv1.FinancialAccountCapitalRecorded{
			LogId: logID, TeamId: team, AccountId: account, Change: change, OccurredOn: on, Note: note,
			ActorId: recordedBy, ActorIsOverride: override, CreatedAtUnix: mustDay(on).Unix() + 3_600,
		}},
	}
}

func deliver(t *testing.T, svc *expense_v1.Service, event *eventsv1.Event) {
	t.Helper()

	err := svc.CapitalFromAccountHandler()(context.Background(), event)
	if err != nil {
		t.Fatalf("deliver %s: %v", event.GetEventId(), err)
	}
}

// expensesOfTeam counts every row a team holds, adjustments included.
func expensesOfTeam(t *testing.T, db *gorm.DB, team uint64) []expense_service_models.ExpenseRecord {
	t.Helper()

	rows := []expense_service_models.ExpenseRecord{}

	err := db.
		Where("team_id = ?", team).
		Order("id").
		Find(&rows).
		Error
	if err != nil {
		t.Fatalf("read team %d's rows: %v", team, err)
	}

	return rows
}

// A SETOR MODAL and a TARIK MODAL on a selling team's account are one Setoran modal and one Prive on Biaya — the account
// row's amount, day, note, who, override mark and account, recorded-on its time, origin ACCOUNT_PAGE, linked; the month
// moves as the checklist's givens 18 (prive and the month total increase) and 19 (deposit and the month total decrease).
// Nothing is published: the account row is the act's own.
func TestCapitalFromAccount_ASellingTeamsSetorAndTarikAreOneRecordOnBiaya(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &sentEvents{}
	svc := newServiceSending(t, db, sent)

	deliver(t, svc, capitalEvent(9_001, teamA, plainAccount, 1_000_000, "2026-11-10", "Top up for stock", false))
	deliver(t, svc, capitalEvent(9_002, teamA, payingAccount, -2_000_000, "2026-11-12", "", true))

	rows := expensesOfTeam(t, db, teamA)
	if len(rows) != 2 {
		t.Fatalf("%d rows on Biaya, want one per act", len(rows))
	}

	deposit, prive := rows[0], rows[1]

	if expensev1.ExpenseType(deposit.Type) != tDeposit || expensev1.ExpenseKind(deposit.Kind) != kOther ||
		deposit.Amount != 1_000_000 || deposit.FinanceAccountID != plainAccount || deposit.Note != "Top up for stock" ||
		!deposit.OccurredAt.Equal(mustDay("2026-11-10")) || deposit.CreatedBy != recordedBy || deposit.IsOverride {
		t.Fatalf("the Setor Modal on Biaya: %+v", deposit)
	}

	if expensev1.ExpenseType(prive.Type) != tPrive || prive.Amount != 2_000_000 || prive.FinanceAccountID != payingAccount ||
		!prive.OccurredAt.Equal(mustDay("2026-11-12")) || prive.Note != "" || !prive.IsOverride {
		t.Fatalf("the Tarik Modal on Biaya: %+v", prive)
	}

	for _, row := range rows {
		if expensev1.ExpenseOrigin(row.Origin) != expensev1.ExpenseOrigin_EXPENSE_ORIGIN_ACCOUNT_PAGE || row.AdjustsExpenseID != 0 {
			t.Fatalf("row %d origin %d, adjusts %d — want the account page's, an expense", row.ID, row.Origin, row.AdjustsExpenseID)
		}

		if row.CreatedAt.Unix() != row.OccurredAt.Unix()+3_600 {
			t.Fatalf("row %d recorded at %v — want the account row's time", row.ID, row.CreatedAt)
		}
	}

	if deposit.AccountLogID != 9_001 || prive.AccountLogID != 9_002 {
		t.Fatalf("links %d, %d — want the account rows 9001, 9002", deposit.AccountLogID, prive.AccountLogID)
	}

	if len(sent.events) != 0 {
		t.Fatalf("published %d events — the account row is the act's own, nothing posts back", len(sent.events))
	}

	list := listOf(t, svc, november())

	got := expenseRows(list)
	if len(got) != 2 || got[0].GetOrigin() != expensev1.ExpenseOrigin_EXPENSE_ORIGIN_ACCOUNT_PAGE ||
		got[1].GetOrigin() != expensev1.ExpenseOrigin_EXPENSE_ORIGIN_ACCOUNT_PAGE {
		t.Fatalf("Biaya's rows %v — want both, marked from the account page", got)
	}

	// Givens 18–19: prive +2.000.000, setoran −1.000.000 — Modal and the month's total +1.000.000; Biaya (spending) unmoved.
	totals := list.GetTotals()
	if totals.GetCapital() != 1_000_000 || totals.GetTotal() != 1_000_000 || totals.GetSpending() != 0 || totals.GetMoneyIn() != 0 {
		t.Fatalf("the month: %+v", totals)
	}

	if totals.GetByType()[int32(tPrive)] != 2_000_000 || totals.GetByType()[int32(tDeposit)] != -1_000_000 {
		t.Fatalf("by type: %v", totals.GetByType())
	}

	// *Recorded in expense analytic metric* — Modal masuk / keluar, never the spending fields.
	res, err := svc.MetricData(context.Background(), connect.NewRequest(&expensev1.MetricDataRequest{
		TeamId:    teamA,
		GroupBy:   analytic_basev1.GroupType_GROUP_TYPE_SUMMARY,
		Filters:   []*analytic_basev1.FilterItem{dateWindow("2026-11-01", "2026-11-30")},
		MetricIds: []string{"metrics/expenses"},
	}))
	if err != nil {
		t.Fatalf("MetricData: %v", err)
	}

	// The metric's total is Biaya's month total since backlog #107 (acceptance analytic/expense_metric.md givens 18, 19):
	// prive +2.000.000, setoran −1.000.000; each its own type field, signed as on Biaya; Other's spending unmoved.
	e := res.Msg.GetMetricDatas()[0].GetExpensesSummary()
	if e.GetCapitalIn() != 1_000_000 || e.GetCapitalOut() != 2_000_000 || e.GetTotal() != totals.GetTotal() || e.GetOther() != 0 ||
		e.GetPrive() != 2_000_000 || e.GetCapitalDeposit() != -1_000_000 {
		t.Fatalf("the metric: %+v", e)
	}
}

// REPLAY — the same event redelivered, and the same account row under another event id (the import beside the door),
// record ONE row and fold the metric once.
func TestCapitalFromAccount_AReplayRecordsOnce(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	event := capitalEvent(9_011, teamA, plainAccount, 750_000, "2026-11-10", "", false)
	deliver(t, svc, event)
	deliver(t, svc, event)

	again := capitalEvent(9_011, teamA, plainAccount, 750_000, "2026-11-10", "", false)
	again.EventId = "financial-account-capital:9011:republished"
	deliver(t, svc, again)

	result, err := svc.ImportCapital(context.Background(), []*eventsv1.Event{event})
	if err != nil {
		t.Fatalf("ImportCapital: %v", err)
	}

	if result.Imported != 0 || result.Already != 1 {
		t.Fatalf("the import beside the door: %+v — want it already there", result)
	}

	if rows := expensesOfTeam(t, db, teamA); len(rows) != 1 {
		t.Fatalf("%d rows for one account row", len(rows))
	}

	if totals := listOf(t, svc, november()).GetTotals(); totals.GetCapital() != -750_000 || totals.GetTotal() != -750_000 {
		t.Fatalf("the month after a replay: %+v", totals)
	}

	var metric float64

	err = db.
		Table("expense_metric_daily_reports").
		Where("team_id = ?", teamA).
		Select("COALESCE(SUM(amount), 0)").
		Scan(&metric).
		Error
	if err != nil {
		t.Fatalf("read the metric: %v", err)
	}

	if metric != 750_000 {
		t.Fatalf("the metric holds %v — folded more than once", metric)
	}
}

// A WAREHOUSE TEAM'S Setor / Tarik Modal stays on the account page — no Biaya row, and the event is claimed so the broker
// does not redeliver it. A team on neither side (the root team) the same.
func TestCapitalFromAccount_AWarehouseTeamsStaysOffBiaya(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	event := capitalEvent(9_021, warehouseTeam, payingAccount, 5_000_000, "2026-11-10", "Owner's top-up", false)
	deliver(t, svc, event)
	deliver(t, svc, capitalEvent(9_022, 1, payingAccount, -100_000, "2026-11-10", "", false))

	if rows := expensesOfTeam(t, db, warehouseTeam); len(rows) != 0 {
		t.Fatalf("a warehouse team's capital wrote %d Biaya rows", len(rows))
	}

	if rows := expensesOfTeam(t, db, 1); len(rows) != 0 {
		t.Fatalf("the root team's capital wrote %d Biaya rows", len(rows))
	}

	var claims int64

	err := db.
		Model(&expense_service_models.ExpenseEventLog{}).
		Where("event_id = ?", event.GetEventId()).
		Count(&claims).
		Error
	if err != nil {
		t.Fatalf("read the claim: %v", err)
	}

	if claims != 1 {
		t.Fatalf("%d claims — a dropped event is still acked once", claims)
	}

	result, err := svc.ImportCapital(context.Background(), []*eventsv1.Event{event})
	if err != nil {
		t.Fatalf("ImportCapital: %v", err)
	}

	if result.NotSelling != 1 || result.Imported != 0 {
		t.Fatalf("the import of a warehouse team's row: %+v", result)
	}
}

// ADJUST / BATALKAN of an account-page row are Biaya's ordinary corrections: a signed row of the same type, made on
// Biaya (no origin), published as ExpenseAdjusted on the same account — the account posts it as `capital`. The month
// follows; a Batalkan nets the act to nothing.
func TestCapitalFromAccount_AdjustAndBatalkanAreOrdinaryCorrections(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &sentEvents{}
	svc := newServiceSending(t, db, sent)

	deliver(t, svc, capitalEvent(9_031, teamA, plainAccount, 1_000_000, "2026-11-10", "", false))
	deposit := expensesOfTeam(t, db, teamA)[0]

	down := correct(t, svc, teamA, deposit.ID, -200_000)
	if down.GetType() != tDeposit || down.GetOrigin() != expensev1.ExpenseOrigin_EXPENSE_ORIGIN_UNSPECIFIED {
		t.Fatalf("the correction: type %v, origin %v — want Setoran modal, made on Biaya", down.GetType(), down.GetOrigin())
	}

	if totals := listOf(t, svc, november()).GetTotals(); totals.GetCapital() != -800_000 || totals.GetTotal() != -800_000 {
		t.Fatalf("after the correction: %+v", totals)
	}

	correct(t, svc, teamA, deposit.ID, -800_000)

	if totals := listOf(t, svc, november()).GetTotals(); totals.GetCapital() != 0 || totals.GetTotal() != 0 {
		t.Fatalf("after Batalkan: %+v", totals)
	}

	if len(sent.events) != 2 {
		t.Fatalf("published %d events — want the two corrections only", len(sent.events))
	}

	for i, want := range []float64{-200_000, -800_000} {
		adjusted := sent.events[i].GetExpenseAdjusted()
		if adjusted == nil || adjusted.GetType() != tDeposit || adjusted.GetFinanceAccountId() != plainAccount ||
			adjusted.GetAmount() != want || adjusted.GetExpenseId() != deposit.ID || adjusted.GetOccurredOn() != "2026-11-10" {
			t.Fatalf("event %d: %v", i, sent.events[i])
		}
	}
}

// SCOPES — the row is the team's own: another selling team's Biaya never reads it.
func TestCapitalFromAccount_OnlyTheTeamsBiayaReadsIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	deliver(t, svc, capitalEvent(9_041, teamA, plainAccount, 1_000_000, "2026-11-10", "", false))

	res, err := svc.ExpenseList(context.Background(), connect.NewRequest(&expensev1.ExpenseListRequest{
		TeamId: teamA + 1, Filter: november(), Page: page1(),
	}))
	if err != nil {
		t.Fatalf("ExpenseList: %v", err)
	}

	if rows := expenseRows(res.Msg); len(rows) != 0 || res.Msg.GetTotals().GetCapital() != 0 {
		t.Fatalf("another team reads %d rows, capital %v", len(rows), res.Msg.GetTotals().GetCapital())
	}
}

// A MALFORMED message — no account row, or a change of 0 — is an error (NACK → dead letter), never a guessed row.
func TestCapitalFromAccount_AMalformedEventIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	for _, event := range []*eventsv1.Event{
		capitalEvent(0, teamA, plainAccount, 1_000, "2026-11-10", "", false),
		capitalEvent(9_051, teamA, plainAccount, 0, "2026-11-10", "", false),
	} {
		err := svc.CapitalFromAccountHandler()(context.Background(), event)
		if err == nil {
			t.Fatalf("%s accepted", event.GetEventId())
		}
	}

	if rows := expensesOfTeam(t, db, teamA); len(rows) != 0 {
		t.Fatalf("%d rows from malformed events", len(rows))
	}
}
