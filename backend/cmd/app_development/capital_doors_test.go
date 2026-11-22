package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
	fam "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// CAPITAL'S TWO DOORS, BOTH SERVICES TOGETHER (prive-and-deposit-on-pengeluaran-are-the-accounts-capital — one act, one
// record, two doors; acceptance financial_account/expense.md givens 18–19). The real financial_account and expense
// services, the real composition-root seams (paying accounts, team sides), and a broker that delivers every event to its
// listener at once — so each act is counted on BOTH sides: one Biaya row and one account capital row, never two.

// doorBus is the broker: each event to the one listener its subscription feeds.
type doorBus struct {
	accounts *financial_account_v1.Service
	expenses *expense_v1.Service
	sent     int
}

func (b *doorBus) send(ctx context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
	b.sent++

	switch event.GetMessage().(type) {
	case *eventsv1.Event_ExpenseCreated, *eventsv1.Event_ExpenseAdjusted:
		return b.accounts.ExpensePaymentHandler()(context.WithoutCancel(ctx), event)
	case *eventsv1.Event_FinancialAccountCapitalRecorded:
		return b.expenses.CapitalFromAccountHandler()(context.WithoutCancel(ctx), event)
	}

	return fmt.Errorf("no listener for %T", event.GetMessage())
}

func newDoors(db *gorm.DB) *doorBus {
	bus := &doorBus{}
	bus.accounts = financial_account_v1.NewService(db, nil, nil, bus.send)
	bus.expenses = expense_v1.NewService(db, bus.send, NewExpensePayingAccounts(bus.accounts), NewExpenseTeamSides(db), nil)

	return bus
}

func doorTeam(t *testing.T, db *gorm.DB, kind, code string) uint64 {
	t.Helper()

	team := team_service_models.Team{Type: kind, Name: "Doors " + code, TeamCode: code}

	err := db.Create(&team).Error
	if err != nil {
		t.Fatalf("team %s: %v", code, err)
	}

	return team.ID
}

func doorAccount(t *testing.T, db *gorm.DB, team uint64, name string) uint64 {
	t.Helper()

	row := fam.FinancialAccount{TeamID: team, Type: fam.TypeCash, Provider: fam.ProviderCash, Status: fam.StatusActive, Name: name}

	err := db.Create(&row).Error
	if err != nil {
		t.Fatalf("account %s: %v", name, err)
	}

	err = db.Create(&fam.OperationalAccount{TeamID: team, AccountID: row.ID}).Error
	if err != nil {
		t.Fatalf("mark %s operational: %v", name, err)
	}

	return row.ID
}

func asOwner() context.Context {
	return san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: 61})
}

func setorTarik(t *testing.T, bus *doorBus, team, account uint64, in bool, amount float64, on string) {
	t.Helper()

	direction := financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_OUT
	if in {
		direction = financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_IN
	}

	_, err := bus.accounts.FinancialAccountCapital(asOwner(), connect.NewRequest(&financial_accountv1.FinancialAccountCapitalRequest{
		TeamId: team, AccountId: account, Direction: direction, Amount: amount, OccurredOn: on, Note: "dari halaman akun",
	}))
	if err != nil {
		t.Fatalf("Setor / Tarik Modal: %v", err)
	}
}

type bookRow struct {
	ChangeType string
	Change     float64
	ExpenseID  uint64
}

func bookOf(t *testing.T, db *gorm.DB, account uint64) []bookRow {
	t.Helper()

	rows := []bookRow{}

	err := db.
		Model(&fam.FinancialAccountLog{}).
		Where("account_id = ?", account).
		Order("id").
		Select("change_type, change, expense_id").
		Scan(&rows).
		Error
	if err != nil {
		t.Fatalf("read the book: %v", err)
	}

	return rows
}

func biayaOf(t *testing.T, bus *doorBus, team uint64, on string) *expensev1.ExpenseListResponse {
	t.Helper()

	res, err := bus.expenses.ExpenseList(asOwner(), connect.NewRequest(&expensev1.ExpenseListRequest{
		TeamId: team, Filter: &expensev1.ExpenseListFilter{From: on, To: on}, Page: &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ExpenseList: %v", err)
	}

	return res.Msg
}

func biayaRows(res *expensev1.ExpenseListResponse) []*expensev1.ExpenseRowItem {
	out := []*expensev1.ExpenseRowItem{}

	for _, item := range res.GetItems() {
		if e := item.GetExpense(); e != nil {
			for _, id := range res.GetIds() {
				if row := e.GetMapData()[id]; row != nil {
					out = append(out, row)
				}
			}
		}
	}

	return out
}

// A SELLING TEAM'S Setor Modal on the account page: ONE account capital row (by hand — no expense named, the history's
// *manual · who*) and ONE Biaya row (Setoran modal, *Dicatat di halaman akun*); Modal and the month's total down by the
// amount (given 19). Batalkan on Biaya: one correction capital row (*dari Biaya #N*), the act netted on both sides.
// A Prive typed on Biaya (the first door) still posts exactly one capital row and no second Biaya row.
func TestCapitalDoors_ASellingTeamsActIsOneRecordOnBothPages(t *testing.T) {
	db := san_testdb.DB(t)
	bus := newDoors(db)

	team := doorTeam(t, db, "selling", "DR-S")
	kas := doorAccount(t, db, team, "Kas Toko")
	on := time.Now().In(time.FixedZone("WIB", 7*60*60)).AddDate(0, 0, -1).Format("2006-01-02")

	setorTarik(t, bus, team, kas, true, 1_000_000, on)

	book := bookOf(t, db, kas)
	if len(book) != 1 || book[0].ChangeType != fam.ChangeCapital || book[0].Change != 1_000_000 || book[0].ExpenseID != 0 {
		t.Fatalf("the account's book after Setor Modal: %+v — want one by-hand capital row", book)
	}

	biaya := biayaOf(t, bus, team, on)

	rows := biayaRows(biaya)
	if len(rows) != 1 || rows[0].GetType() != expensev1.ExpenseType_EXPENSE_TYPE_CAPITAL_DEPOSIT ||
		rows[0].GetOrigin() != expensev1.ExpenseOrigin_EXPENSE_ORIGIN_ACCOUNT_PAGE || rows[0].GetAmount() != 1_000_000 ||
		rows[0].GetFinanceAccountId() != kas || rows[0].GetCreatedBy() != 61 {
		t.Fatalf("Biaya after Setor Modal: %v — want one Setoran modal from the account page", rows)
	}

	if totals := biaya.GetTotals(); totals.GetCapital() != -1_000_000 || totals.GetTotal() != -1_000_000 {
		t.Fatalf("the month after Setor Modal: %+v", totals)
	}

	deposit := rows[0].GetId()

	_, err := bus.expenses.ExpenseAdjust(asOwner(), connect.NewRequest(&expensev1.ExpenseAdjustRequest{
		TeamId: team, ExpenseId: deposit, Amount: -1_000_000, Note: "Batalkan",
	}))
	if err != nil {
		t.Fatalf("Batalkan: %v", err)
	}

	book = bookOf(t, db, kas)
	if len(book) != 2 || book[1].ChangeType != fam.ChangeCapital || book[1].Change != -1_000_000 || book[1].ExpenseID != deposit {
		t.Fatalf("the book after Batalkan: %+v — want one correction naming the expense", book)
	}

	if totals := biayaOf(t, bus, team, on).GetTotals(); totals.GetCapital() != 0 || totals.GetTotal() != 0 {
		t.Fatalf("the month after Batalkan: %+v", totals)
	}

	// The first door: a Prive typed on Biaya.
	_, err = bus.expenses.ExpenseCreate(asOwner(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId: team, Type: expensev1.ExpenseType_EXPENSE_TYPE_PRIVE, Amount: 300_000, OccurredAt: on, FinanceAccountId: kas,
	}))
	if err != nil {
		t.Fatalf("Prive on Biaya: %v", err)
	}

	book = bookOf(t, db, kas)
	if len(book) != 3 || book[2].ChangeType != fam.ChangeCapital || book[2].Change != -300_000 || book[2].ExpenseID == 0 {
		t.Fatalf("the book after a Prive on Biaya: %+v — want one capital row naming it", book)
	}

	var count int64

	err = db.
		Model(&expense_service_models.ExpenseRecord{}).
		Where("team_id = ? AND adjusts_expense_id = 0", team).
		Count(&count).
		Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if count != 2 {
		t.Fatalf("%d Biaya records — want the Setoran modal and the Prive, one each", count)
	}
}

// A WAREHOUSE TEAM'S Setor Modal stays exactly as today: its one capital row, the balance moved — and never a Biaya row.
func TestCapitalDoors_AWarehouseTeamsCapitalNeverReachesBiaya(t *testing.T) {
	db := san_testdb.DB(t)
	bus := newDoors(db)

	team := doorTeam(t, db, "warehouse", "DR-W")
	kas := doorAccount(t, db, team, "Kas Gudang")
	on := time.Now().In(time.FixedZone("WIB", 7*60*60)).AddDate(0, 0, -1).Format("2006-01-02")

	setorTarik(t, bus, team, kas, true, 2_000_000, on)
	setorTarik(t, bus, team, kas, false, 500_000, on)

	book := bookOf(t, db, kas)
	if len(book) != 2 || book[0].Change != 2_000_000 || book[1].Change != -500_000 || book[0].ExpenseID != 0 || book[1].ExpenseID != 0 {
		t.Fatalf("the warehouse's book: %+v", book)
	}

	var count int64

	err := db.
		Model(&expense_service_models.ExpenseRecord{}).
		Where("team_id = ?", team).
		Count(&count).
		Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if count != 0 {
		t.Fatalf("a warehouse team's capital wrote %d Biaya rows", count)
	}
}
