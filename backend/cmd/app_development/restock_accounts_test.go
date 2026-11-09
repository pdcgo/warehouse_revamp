package main

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// The seam a restock asks before it is raised or its account changed (a-restock-names-its-paying-account): the team's
// account, whether it is active, whether it is marked operational — another team's reads as absent. Then the same
// seam wired into inventory: a restock naming a plain account is refused, an operational one is raised.
func TestRestockPayingAccounts_AnswersFromTheAccounts(t *testing.T) {
	db := san_testdb.DB(t)
	seam := NewRestockPayingAccounts(financial_account_v1.NewService(db, nil, nil))
	ctx := context.Background()

	const team, otherTeam uint64 = 9_311, 9_312

	account := func(teamID uint64, name, status string, operational bool) uint64 {
		t.Helper()

		row := m.FinancialAccount{
			TeamID: teamID, Type: m.TypeCash, Provider: m.ProviderCash, Status: status, Name: name,
		}

		err := db.Create(&row).Error
		if err != nil {
			t.Fatalf("seed %s: %v", name, err)
		}

		if operational {
			err = db.Create(&m.OperationalAccount{TeamID: teamID, AccountID: row.ID}).Error
			if err != nil {
				t.Fatalf("mark %s: %v", name, err)
			}
		}

		return row.ID
	}

	ops := account(team, "Kas Operasional", m.StatusActive, true)
	plain := account(team, "Kas Pemilik", m.StatusActive, false)
	archived := account(team, "Kas Lama", m.StatusArchived, false)
	theirs := account(otherTeam, "Kas Mereka", m.StatusActive, true)

	cases := []struct {
		id          uint64
		found       bool
		active      bool
		operational bool
		name        string
	}{
		{ops, true, true, true, "Kas Operasional"},
		{plain, true, true, false, "Kas Pemilik"},
		{archived, true, false, false, "Kas Lama"},
		{theirs, false, false, false, ""},
	}

	for _, tc := range cases {
		got, found, err := seam.Account(ctx, team, tc.id)
		if err != nil {
			t.Fatalf("account %d: %v", tc.id, err)
		}

		if found != tc.found || got.Active != tc.active || got.Operational != tc.operational || got.Name != tc.name {
			t.Fatalf("account %d = %+v found %v, want %q found %v active %v operational %v",
				tc.id, got, found, tc.name, tc.found, tc.active, tc.operational)
		}
	}

	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, seam)

	raise := func(accountID uint64) error {
		_, err := inventory.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: team, WarehouseId: 9_313, FinanceAccountId: accountID,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, ProductCode: "SKU1", Name: "Widget", Count: 1, Total: 100},
			},
		}))

		return err
	}

	err := raise(plain)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "Kas Pemilik") {
		t.Fatalf("a plain account: %v, want FailedPrecondition naming Kas Pemilik", err)
	}

	err = raise(ops)
	if err != nil {
		t.Fatalf("an operational account: %v", err)
	}
}
