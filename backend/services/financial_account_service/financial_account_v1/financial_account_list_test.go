package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

func list(t *testing.T, svc *financial_account_v1.Service, team uint64, filter *financial_accountv1.FinancialAccountListFilter) ([]*financial_accountv1.FinancialAccount, uint64) {
	t.Helper()

	resp, err := svc.FinancialAccountList(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountListRequest{
		TeamId:      team,
		Filter:      filter,
		DataRequest: []financial_accountv1.FinancialAccountListDataType{financial_accountv1.FinancialAccountListDataType_FINANCIAL_ACCOUNT_LIST_DATA_TYPE_ACCOUNT},
		Page:        &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	byID := map[uint64]*financial_accountv1.FinancialAccount{}
	for _, item := range resp.Msg.GetItems() {
		for id, a := range item.GetAccount().GetMapData() {
			byID[id] = a
		}
	}

	out := []*financial_accountv1.FinancialAccount{}
	for _, id := range resp.Msg.GetIds() {
		out = append(out, byID[id])
	}

	return out, resp.Msg.GetPageInfo().GetTotalItems()
}

func names(accounts []*financial_accountv1.FinancialAccount) []string {
	out := []string{}
	for _, a := range accounts {
		out = append(out, a.GetName())
	}

	return out
}

func TestFinancialAccountList_ActiveOnlyByDefault_TeamScoped_ByName(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mustCreate(t, svc, cash(teamA, "kas", 0))
	mustCreate(t, svc, bca(teamA, "BCA", "5555000005", 0))
	gone := mustCreate(t, svc, cash(teamA, "Archived", 0))
	mustCreate(t, svc, cash(teamB, "Other team", 0))

	_, err := svc.FinancialAccountArchive(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountArchiveRequest{TeamId: teamA, AccountId: gone.GetId()}))
	if err != nil {
		t.Fatalf("archive: %v", err)
	}

	got, total := list(t, svc, teamA, nil)
	if total != 2 || len(got) != 2 || got[0].GetName() != "BCA" || got[1].GetName() != "kas" {
		t.Fatalf("list = %v (total %d)", names(got), total)
	}

	// The accounts page asks for archived ones too — after the active.
	got, _ = list(t, svc, teamA, &financial_accountv1.FinancialAccountListFilter{IncludeArchived: true})
	if len(got) != 3 || got[2].GetName() != "Archived" {
		t.Fatalf("with archived = %v", names(got))
	}
}

func TestFinancialAccountList_FiltersOperationalShopAndSearch(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	ops := mustCreate(t, svc, bca(teamA, "BCA Operasional", "6666000006", 0))
	mustCreate(t, svc, bca(teamA, "BCA Gaji", "6666000007", 0))

	_, err := svc.FinancialAccountOperationalSet(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountOperationalSetRequest{
		TeamId: teamA, AccountId: ops.GetId(), Operational: true,
	}))
	if err != nil {
		t.Fatalf("mark: %v", err)
	}

	_, err = svc.FinancialAccountShopSet(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountShopSetRequest{
		TeamId: teamA, ShopId: 501, AccountId: ops.GetId(),
	}))
	if err != nil {
		t.Fatalf("shop set: %v", err)
	}

	got, _ := list(t, svc, teamA, &financial_accountv1.FinancialAccountListFilter{OperationalOnly: true})
	if len(got) != 1 || !got[0].GetOperational() || got[0].GetShopIds()[0] != 501 {
		t.Fatalf("operational = %+v", got)
	}

	got, _ = list(t, svc, teamA, &financial_accountv1.FinancialAccountListFilter{ShopId: 501})
	if len(got) != 1 || got[0].GetId() != ops.GetId() {
		t.Fatalf("of shop = %v", names(got))
	}

	got, _ = list(t, svc, teamA, &financial_accountv1.FinancialAccountListFilter{Q: "gaji"})
	if len(got) != 1 || got[0].GetName() != "BCA Gaji" {
		t.Fatalf("search = %v", names(got))
	}

	got, _ = list(t, svc, teamA, &financial_accountv1.FinancialAccountListFilter{Q: "000007"})
	if len(got) != 1 {
		t.Fatalf("search by number = %v", names(got))
	}
}

func TestFinancialAccountList_PagesAndServesTheGeneralSlice(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	for _, name := range []string{"A", "B", "C"} {
		mustCreate(t, svc, cash(teamA, name, 0))
	}

	resp, err := svc.FinancialAccountList(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountListRequest{
		TeamId:      teamA,
		DataRequest: []financial_accountv1.FinancialAccountListDataType{financial_accountv1.FinancialAccountListDataType_FINANCIAL_ACCOUNT_LIST_DATA_TYPE_GENERAL},
		Page:        &commonv1.CommonPagination{Page: 2, Limit: 2},
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	if len(resp.Msg.GetIds()) != 1 || resp.Msg.GetPageInfo().GetTotalItems() != 3 || resp.Msg.GetPageInfo().GetTotalPage() != 2 {
		t.Fatalf("page 2 = %+v", resp.Msg)
	}

	general := resp.Msg.GetItems()[0].GetGeneral().GetMapData()[resp.Msg.GetIds()[0]]
	if general.GetName() != "C" {
		t.Fatalf("general = %+v", general)
	}
}
