package financial_account_v1_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// Teams far from any seeded id, so a test never collides with fixture data a migration added.
const (
	teamA uint64 = 9_101
	teamB uint64 = 9_102
	ani   uint64 = 61
)

var jakarta = time.FixedZone("WIB", 7*60*60)

// day is a Jakarta date `ago` days before today — what a person picks.
func day(ago int) string {
	return time.Now().In(jakarta).AddDate(0, 0, -ago).Format("2006-01-02")
}

// shopsOf is a ShopChecker that knows which shops belong to which team.
type shopsOf map[uint64]uint64

func (s shopsOf) ShopOfTeam(_ context.Context, teamID, shopID uint64) error {
	if s[shopID] != teamID {
		return errors.New("not this team's shop")
	}

	return nil
}

// Shops 501 and 502 are team A's, 601 team B's.
var testShops = shopsOf{501: teamA, 502: teamA, 601: teamB}

func newService(t *testing.T, db *gorm.DB) *financial_account_v1.Service {
	t.Helper()

	return financial_account_v1.NewService(db, testShops)
}

// asAni is a context carrying a signed-in person, as the access interceptor leaves it.
func asAni() context.Context {
	return san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: ani})
}

func connectCode(t *testing.T, err error) connect.Code {
	t.Helper()

	if err == nil {
		t.Fatal("expected an error, got nil")
	}

	return connect.CodeOf(err)
}

type accountSpec struct {
	team     uint64
	name     string
	typ      financial_accountv1.FinancialAccountType
	provider financial_accountv1.FinancialAccountProvider
	number   string
	opening  float64
	on       string
}

func bca(team uint64, name, number string, opening float64) accountSpec {
	return accountSpec{
		team:     team,
		name:     name,
		typ:      financial_accountv1.FinancialAccountType_FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT,
		provider: financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_BCA,
		number:   number,
		opening:  opening,
	}
}

func cash(team uint64, name string, opening float64) accountSpec {
	return accountSpec{
		team:     team,
		name:     name,
		typ:      financial_accountv1.FinancialAccountType_FINANCIAL_ACCOUNT_TYPE_CASH,
		provider: financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_CASH,
		opening:  opening,
	}
}

func create(svc *financial_account_v1.Service, spec accountSpec) (*financial_accountv1.FinancialAccount, error) {
	on := spec.on
	if on == "" {
		on = day(10)
	}

	resp, err := svc.FinancialAccountCreate(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountCreateRequest{
		TeamId:         spec.team,
		Type:           spec.typ,
		Provider:       spec.provider,
		Name:           spec.name,
		HolderName:     "PT Uji",
		AccountNumber:  spec.number,
		OpeningBalance: spec.opening,
		OpeningOn:      on,
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg.GetAccount(), nil
}

func mustCreate(t *testing.T, svc *financial_account_v1.Service, spec accountSpec) *financial_accountv1.FinancialAccount {
	t.Helper()

	a, err := create(svc, spec)
	if err != nil {
		t.Fatalf("create %s: %v", spec.name, err)
	}

	return a
}

// balance reads an account's balance straight from the table.
func balance(t *testing.T, db *gorm.DB, id uint64) float64 {
	t.Helper()

	var a m.FinancialAccount

	err := db.Where("id = ?", id).Take(&a).Error
	if err != nil {
		t.Fatalf("load account %d: %v", id, err)
	}

	return a.Balance
}

// logs reads an account's rows in entry order.
func logs(t *testing.T, db *gorm.DB, id uint64) []m.FinancialAccountLog {
	t.Helper()

	rows := []m.FinancialAccountLog{}

	err := db.Where("account_id = ?", id).Order("id").Find(&rows).Error
	if err != nil {
		t.Fatalf("load logs of %d: %v", id, err)
	}

	return rows
}

// daily reads an account's report rows, oldest first.
func daily(t *testing.T, db *gorm.DB, id uint64) []m.FinancialAccountDailyReport {
	t.Helper()

	rows := []m.FinancialAccountDailyReport{}

	err := db.Where("account_id = ?", id).Order("day").Find(&rows).Error
	if err != nil {
		t.Fatalf("load daily rows of %d: %v", id, err)
	}

	return rows
}

func transfer(svc *financial_account_v1.Service, team, from, to uint64, amount float64, on string) error {
	_, err := svc.FinancialAccountTransfer(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountTransferRequest{
		TeamId:        team,
		FromAccountId: from,
		ToAccountId:   to,
		Amount:        amount,
		OccurredOn:    on,
		Note:          "test",
	}))

	return err
}

func mustTransfer(t *testing.T, svc *financial_account_v1.Service, team, from, to uint64, amount float64, on string) {
	t.Helper()

	err := transfer(svc, team, from, to, amount, on)
	if err != nil {
		t.Fatalf("transfer: %v", err)
	}
}
