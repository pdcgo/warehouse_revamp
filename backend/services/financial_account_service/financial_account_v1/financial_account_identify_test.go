package financial_account_v1_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

// unknownWithWithdrawals is what the listener leaves behind: an unknown account for shop 501, holding two
// withdrawals.
func unknownWithWithdrawals(t *testing.T, db *gorm.DB, svc *financial_account_v1.Service) uint64 {
	t.Helper()

	withdraw(t, svc, "evt-unknown-1", teamA, 501, -1_700_000, day(12))
	withdraw(t, svc, "evt-unknown-2", teamA, 501, -2_500_000, day(4))

	var link m.ShopAccount
	if err := db.Where("shop_id = ?", 501).Take(&link).Error; err != nil {
		t.Fatalf("no shop link: %v", err)
	}

	return link.AccountID
}

func identify(svc *financial_account_v1.Service, id uint64, target any) (*financial_accountv1.FinancialAccount, error) {
	req := &financial_accountv1.FinancialAccountIdentifyRequest{TeamId: teamA, AccountId: id}

	switch v := target.(type) {
	case *financial_accountv1.FinancialAccountIdentity:
		req.Target = &financial_accountv1.FinancialAccountIdentifyRequest_FillIn{FillIn: v}
	case uint64:
		req.Target = &financial_accountv1.FinancialAccountIdentifyRequest_MoveIntoAccountId{MoveIntoAccountId: v}
	}

	resp, err := svc.FinancialAccountIdentify(asAni(), connect.NewRequest(req))
	if err != nil {
		return nil, err
	}

	return resp.Msg.GetAccount(), nil
}

func bcaIdentity(number, name string) *financial_accountv1.FinancialAccountIdentity {
	return &financial_accountv1.FinancialAccountIdentity{
		Type:          financial_accountv1.FinancialAccountType_FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT,
		Provider:      financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_BCA,
		AccountNumber: number,
		HolderName:    "PT Melati",
		Name:          name,
	}
}

// FILL IN — the unknown account becomes the real one: same id, rows kept.
func TestFinancialAccountIdentify_FillInKeepsTheRows(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := unknownWithWithdrawals(t, db, svc)

	got, err := identify(svc, id, bcaIdentity("7778889990", "BCA TikTok"))
	if err != nil {
		t.Fatalf("fill in: %v", err)
	}

	if got.GetId() != id || got.GetName() != "BCA TikTok" || got.GetProvider() != financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_BCA {
		t.Fatalf("filled = %+v", got)
	}

	if len(logs(t, db, id)) != 2 || balance(t, db, id) != 4_200_000 {
		t.Fatal("the withdrawals did not stay with it")
	}
}

// A recorded number cannot be filled in — the refusal points at MOVE IN.
func TestFinancialAccountIdentify_FillingInARecordedNumberPointsAtMoveIn(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mustCreate(t, svc, bca(teamA, "BCA Ops", "1234567890", 0))
	id := unknownWithWithdrawals(t, db, svc)

	_, err := identify(svc, id, bcaIdentity("1234567890", "BCA TikTok"))
	if code := connectCode(t, err); code != connect.CodeAlreadyExists {
		t.Fatalf("code = %v, want AlreadyExists", code)
	}

	if !strings.Contains(err.Error(), "move the money into it") {
		t.Fatalf("message = %q", err.Error())
	}
}

// MOVE IN — one act: the balance transfers in, the shop re-points, the unknown is archived at zero.
func TestFinancialAccountIdentify_MoveInTransfersRepointsAndArchives(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	real := mustCreate(t, svc, bca(teamA, "BCA Ops", "1234567891", 1_000))
	id := unknownWithWithdrawals(t, db, svc)

	got, err := identify(svc, id, real.GetId())
	if err != nil {
		t.Fatalf("move in: %v", err)
	}

	if got.GetId() != real.GetId() || len(got.GetShopIds()) != 1 || got.GetShopIds()[0] != 501 {
		t.Fatalf("moved into = %+v", got)
	}

	if balance(t, db, real.GetId()) != 4_201_000 || balance(t, db, id) != 0 {
		t.Fatal("the balance did not move across")
	}

	var unknown m.FinancialAccount
	if err := db.Where("id = ?", id).Take(&unknown).Error; err != nil || unknown.Status != m.StatusArchived {
		t.Fatalf("unknown status = %q, %v", unknown.Status, err)
	}

	// The shop's NEXT withdrawal lands in the real account.
	withdraw(t, svc, "evt-after-move", teamA, 501, -100, day(0))
	if balance(t, db, real.GetId()) != 4_201_100 {
		t.Fatal("a later withdrawal did not follow the shop")
	}
}

func TestFinancialAccountIdentify_OnlyAnUnknownAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := mustCreate(t, svc, bca(teamA, "BCA", "1234567892", 0))

	_, err := identify(svc, a.GetId(), bcaIdentity("1234567893", "Other"))
	if code := connectCode(t, err); code != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want FailedPrecondition", code)
	}
}
