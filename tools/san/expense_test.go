package main

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
	fam "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// THE ONE-TIME IMPORT of the account page's capital (the-expense-types-prototype-is-accepted — *old rows: a selling team's
// old Setor / Tarik Modal are brought into Biaya once (exact type, linked so nothing posts twice)*;
// prive-and-deposit-on-pengeluaran-are-the-accounts-capital).

func importTeam(t *testing.T, db *gorm.DB, teamType, code string) uint64 {
	t.Helper()

	team := team_service_models.Team{Type: teamType, Name: "Team " + code, TeamCode: code}

	err := db.Create(&team).Error
	if err != nil {
		t.Fatalf("seed team %s: %v", code, err)
	}

	return team.ID
}

func importAccount(t *testing.T, db *gorm.DB, team uint64, name string) uint64 {
	t.Helper()

	row := fam.FinancialAccount{TeamID: team, Type: fam.TypeCash, Provider: fam.ProviderCash, Status: fam.StatusActive, Name: name}

	err := db.Create(&row).Error
	if err != nil {
		t.Fatalf("seed account %s: %v", name, err)
	}

	return row.ID
}

// oldCapital is a Setor / Tarik Modal made on the account page before the second door — through the real RPC, with no
// broker (the door did not exist), so the row is exactly what the account page always wrote.
func oldCapital(t *testing.T, accounts *financial_account_v1.Service, team, account uint64, in bool, amount float64, on, note string) uint64 {
	t.Helper()

	direction := financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_OUT
	if in {
		direction = financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_IN
	}

	ctx := san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: 61})

	resp, err := accounts.FinancialAccountCapital(ctx, connect.NewRequest(&financial_accountv1.FinancialAccountCapitalRequest{
		TeamId: team, AccountId: account, Direction: direction, Amount: amount, OccurredOn: on, Note: note,
	}))
	if err != nil {
		t.Fatalf("capital: %v", err)
	}

	return resp.Msg.GetLog().GetId()
}

type accountSnapshot struct {
	rows    int64
	balance float64
}

func accountState(t *testing.T, db *gorm.DB, account uint64) accountSnapshot {
	t.Helper()

	var s accountSnapshot

	err := db.
		Model(&fam.FinancialAccountLog{}).
		Where("account_id = ?", account).
		Count(&s.rows).
		Error
	if err != nil {
		t.Fatalf("count rows: %v", err)
	}

	err = db.
		Model(&fam.FinancialAccountLog{}).
		Where("account_id = ?", account).
		Select("COALESCE(SUM(change), 0)").
		Scan(&s.balance).
		Error
	if err != nil {
		t.Fatalf("sum rows: %v", err)
	}

	return s
}

// RUN TWICE → ONCE. A selling team's two old capital rows become one Setoran modal and one Prive each — exact type, the
// row's amount, day, note, who and account, origin account page, linked; a warehouse team's row is left alone; a row
// the expense listener posted from Biaya (`expense_id` set) is not brought in again; the account's book is untouched (no
// row posts). The second run imports nothing. A dry run writes nothing.
func TestImportCapital_BringsASellingTeamsOldCapitalIntoBiayaOnce(t *testing.T) {
	db := san_testdb.DB(t)
	san := &San{db: db, teams: NewTeamCodes(db), target: "test"}
	accounts := financial_account_v1.NewService(db, nil, nil, nil)

	selling := importTeam(t, db, "selling", "IMP-S")
	warehouse := importTeam(t, db, "warehouse", "IMP-W")

	sellingKas := importAccount(t, db, selling, "Kas Toko")
	warehouseKas := importAccount(t, db, warehouse, "Kas Gudang")

	setor := oldCapital(t, accounts, selling, sellingKas, true, 5_000_000, "2026-10-01", "Modal awal")
	tarik := oldCapital(t, accounts, selling, sellingKas, false, 1_250_000, "2026-10-28", "")
	oldCapital(t, accounts, warehouse, warehouseKas, true, 3_000_000, "2026-10-02", "Modal gudang")

	// A Prive typed on Biaya since P1 — its account row names its expense: Biaya already holds it.
	biaya := fam.FinancialAccountLog{
		TeamID: selling, AccountID: sellingKas, ChangeType: fam.ChangeCapital, Change: -100_000, BalanceAfter: 3_650_000,
		Description: "Expense E-555", ActorID: 61, OccurredAt: mustJakartaDay(t, "2026-10-30"), ExpenseID: 555,
	}

	err := db.Create(&biaya).Error
	if err != nil {
		t.Fatalf("seed a Biaya capital row: %v", err)
	}

	beforeSelling := accountState(t, db, sellingKas)
	beforeWarehouse := accountState(t, db, warehouseKas)

	dry, err := san.ImportCapital(context.Background(), true)
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}

	if dry.Imported < 2 || len(expensesOf(t, db, selling)) != 0 {
		t.Fatalf("the dry run: %+v, %d rows written", dry, len(expensesOf(t, db, selling)))
	}

	first, err := san.ImportCapital(context.Background(), false)
	if err != nil {
		t.Fatalf("import: %v", err)
	}

	second, err := san.ImportCapital(context.Background(), false)
	if err != nil {
		t.Fatalf("import again: %v", err)
	}

	if second.Imported != 0 || second.Already != first.Imported+first.Already {
		t.Fatalf("the second run: %+v after %+v — want nothing new", second, first)
	}

	rows := expensesOf(t, db, selling)
	if len(rows) != 2 {
		t.Fatalf("%d Biaya rows for the selling team — want its two account-page rows, once each", len(rows))
	}

	want := []struct {
		log    uint64
		typ    int32
		amount float64
		on     string
		note   string
	}{
		{setor, 16, 5_000_000, "2026-10-01", "Modal awal"},
		{tarik, 15, 1_250_000, "2026-10-28", ""},
	}

	for i, w := range want {
		row := rows[i]
		if row.AccountLogID != w.log || row.Type != w.typ || row.Kind != 4 || row.Amount != w.amount ||
			row.OccurredAt.Format("2006-01-02") != w.on || row.Note != w.note || row.CreatedBy != 61 ||
			row.FinanceAccountID != sellingKas || row.Origin != 1 || row.AdjustsExpenseID != 0 {
			t.Fatalf("row %d: %+v — want %+v", i, row, w)
		}
	}

	if rows := expensesOf(t, db, warehouse); len(rows) != 0 {
		t.Fatalf("a warehouse team's capital brought %d rows into Biaya", len(rows))
	}

	if after := accountState(t, db, sellingKas); after != beforeSelling {
		t.Fatalf("the selling account's book moved: %+v → %+v — nothing may post", beforeSelling, after)
	}

	if after := accountState(t, db, warehouseKas); after != beforeWarehouse {
		t.Fatalf("the warehouse account's book moved: %+v → %+v", beforeWarehouse, after)
	}
}

func mustJakartaDay(t *testing.T, raw string) time.Time {
	t.Helper()

	day, err := time.ParseInLocation("2006-01-02", raw, time.FixedZone("WIB", 7*60*60))
	if err != nil {
		t.Fatalf("day %q: %v", raw, err)
	}

	return day
}

func expensesOf(t *testing.T, db *gorm.DB, team uint64) []expense_service_models.ExpenseRecord {
	t.Helper()

	rows := []expense_service_models.ExpenseRecord{}

	err := db.
		Where("team_id = ?", team).
		Order("occurred_at, id").
		Find(&rows).
		Error
	if err != nil {
		t.Fatalf("read Biaya rows: %v", err)
	}

	return rows
}
