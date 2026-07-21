package expense_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

func list(t *testing.T, svc *expense_v1.Service, req *expensev1.ExpenseListRequest) *expensev1.ExpenseListResponse {
	t.Helper()

	if req.GetPage() == nil {
		req.Page = page1()
	}

	res, err := svc.ExpenseList(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("ExpenseList: %v", err)
	}

	return res.Msg
}

// #168 — THE PERIOD FILTER, and the totals that respect it.
//
// This is the assertion the profit screen stands on. The list is paginated, so the interesting failure
// is a total computed from the loaded PAGE: it would be right on a page big enough to hold everything
// and quietly wrong the moment it is not. So the page is deliberately smaller than the period.
func TestCostList_FiltersByPeriodAndTotalsTheWholeOfIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	// Three costs in July, one in June that must not count.
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 2_000_000, "2026-07-03")
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 1_000_000, "2026-07-10")
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 12_000_000, "2026-07-05")
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 11_000_000, "2026-06-05")

	got := list(t, svc, &expensev1.ExpenseListRequest{
		TeamId: teamA,
		From:   "2026-07-01",
		To:     "2026-07-31",
		// ONE row per page — so a page-derived total could only ever be a fraction of the truth.
		Page: &commonv1.PageFilter{Page: 1, Limit: 1},
	})

	if n := len(got.GetExpenses()); n != 1 {
		t.Fatalf("the page holds %d rows, want 1 — the rest of this test assumes a partial page", n)
	}

	// Newest first, by the date the cost BELONGS TO.
	if on := got.GetExpenses()[0].GetOccurredAt(); on != "2026-07-10" {
		t.Fatalf("first row is dated %s, want the newest in the period (2026-07-10)", on)
	}

	// Three rows matched, not the one on the page.
	if n := got.GetPageInfo().GetTotalItems(); n != 3 {
		t.Fatalf("total items = %d, want 3", n)
	}

	// 2.000.000 + 1.000.000 + 12.000.000 = 15.000.000. June's 11.000.000 is OUTSIDE the period, and a
	// filter that leaked it would read 26.000.000.
	if total := got.GetTotals().GetTotal(); total != 15_000_000 {
		t.Fatalf("period total = %d, want 15000000 (June must not count)", total)
	}

	// And per kind, so the summary cards need no second call.
	byKind := got.GetTotals().GetByKind()
	if byKind[int32(expensev1.ExpenseKind_EXPENSE_KIND_ADS)] != 3_000_000 {
		t.Fatalf("ads total = %d, want 3000000", byKind[int32(expensev1.ExpenseKind_EXPENSE_KIND_ADS)])
	}
	if byKind[int32(expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL)] != 12_000_000 {
		t.Fatalf("payroll total = %d, want 12000000", byKind[int32(expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL)])
	}

	// A kind with nothing in the period is ABSENT, not 0 — absent and zero read identically on a card,
	// and building the empty ones would mean the handler knowing the enum's members.
	if _, present := byKind[int32(expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL)]; present {
		t.Fatal("a kind with no costs in the period was reported anyway")
	}
}

// #168 — the period is INCLUSIVE at both ends. An off-by-one here silently drops the first or last
// day of every month, which is exactly the kind of wrong nobody notices.
func TestCostList_ThePeriodIncludesBothEnds(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 100, "2026-07-01")
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 200, "2026-07-31")

	got := list(t, svc, &expensev1.ExpenseListRequest{TeamId: teamA, From: "2026-07-01", To: "2026-07-31"})

	if total := got.GetTotals().GetTotal(); total != 300 {
		t.Fatalf("total = %d, want 300 — both the first and last day of the period must count", total)
	}
}

// #168 — no period means every cost ever. The filter must not become a requirement.
func TestCostList_NoPeriodMeansEverything(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 100, "2026-07-01")
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 200, "2020-01-01")

	got := list(t, svc, &expensev1.ExpenseListRequest{TeamId: teamA})

	if total := got.GetTotals().GetTotal(); total != 300 {
		t.Fatalf("unfiltered total = %d, want 300", total)
	}
}

// #168 — this is the money: one team must never read another's costs.
func TestCostList_ScopedToItsTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 9_000_000, "2026-07-05")

	got := list(t, svc, &expensev1.ExpenseListRequest{TeamId: 3})

	if n := len(got.GetExpenses()); n != 0 {
		t.Fatalf("another team's costs leaked: %v", got.GetExpenses())
	}
	if total := got.GetTotals().GetTotal(); total != 0 {
		t.Fatalf("another team's total leaked: %d", total)
	}
}

// #168 — narrowing to one kind narrows the TOTALS with it, not just the rows.
func TestCostList_FiltersByKind(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 2_000_000, "2026-07-03")
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 12_000_000, "2026-07-05")

	got := list(t, svc, &expensev1.ExpenseListRequest{
		TeamId: teamA, Kind: expensev1.ExpenseKind_EXPENSE_KIND_ADS,
	})

	if n := len(got.GetExpenses()); n != 1 {
		t.Fatalf("filtered list holds %d rows, want 1", n)
	}
	if total := got.GetTotals().GetTotal(); total != 2_000_000 {
		t.Fatalf("filtered total = %d, want 2000000 — the payroll must not count", total)
	}
}
