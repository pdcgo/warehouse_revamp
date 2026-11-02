package liability_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// asCaller is a request context as the access interceptor leaves it: who is calling, the team the call is scoped to,
// and their role there. ROLE_UNSPECIFIED is Root or the Administrator, in by the root-team bypass.
func asCaller(userID, scope uint64, role role_basev1.Role) context.Context {
	ctx := san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: userID})
	ctx = san_auth.WithScope(ctx, scope)

	return san_auth.WithCallerRole(ctx, role)
}

const rootUser uint64 = 1

func storedPayment(t *testing.T, db *gorm.DB, id uint64) liability_service_models.LiabilityPayment {
	t.Helper()

	var row liability_service_models.LiabilityPayment

	err := db.First(&row, id).Error
	if err != nil {
		t.Fatalf("read payment %d: %v", id, err)
	}

	return row
}

// legOverrides is the flag on each leg a payment's confirm posted.
func legOverrides(t *testing.T, db *gorm.DB, paymentID uint64) []bool {
	t.Helper()

	rows := []liability_service_models.LiabilityLog{}

	err := db.Where("source_type = ? AND source_id = ?", "payment", paymentID).Order("id").Find(&rows).Error
	if err != nil {
		t.Fatalf("read legs of payment %d: %v", paymentID, err)
	}

	out := make([]bool, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.IsOverride)
	}

	return out
}

// AN OVERRIDE IS STAMPED (an-override-is-stamped-in-every-service): a payment records TWO acts by two people, so each
// carries its own flag — and the confirm's ledger legs carry the confirmer's. A leg an event posted (here the debt
// itself, posted with no caller) is the system's and reads false.
func TestOverride_APaymentStampsEachOfItsTwoActs(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	oweThem(t, svc, db, 30_000, 990_001)

	sellerOwner := asCaller(42, selling, role_basev1.Role_ROLE_SELLING_OWNER)
	warehouseOwner := asCaller(43, warehouse, role_basev1.Role_ROLE_WAREHOUSE_OWNER)
	rootInSelling := asCaller(rootUser, selling, role_basev1.Role_ROLE_UNSPECIFIED)
	rootInWarehouse := asCaller(rootUser, warehouse, role_basev1.Role_ROLE_UNSPECIFIED)

	record := func(ctx context.Context) uint64 {
		res, err := svc.LiabilityPaymentRecord(ctx, connect.NewRequest(&liabilityv1.LiabilityPaymentRecordRequest{
			TeamId: selling, CreditorTeamId: warehouse, Amount: 10_000, Note: "BCA 1234",
		}))
		if err != nil {
			t.Fatalf("record: %v", err)
		}

		return res.Msg.GetPayment().GetId()
	}

	confirm := func(ctx context.Context, id uint64) {
		_, err := svc.LiabilityPaymentConfirm(ctx, connect.NewRequest(&liabilityv1.LiabilityPaymentConfirmRequest{
			TeamId: warehouse, PaymentId: id,
		}))
		if err != nil {
			t.Fatalf("confirm %d: %v", id, err)
		}
	}

	// Root records for the seller; the warehouse's own owner confirms.
	first := record(rootInSelling)
	confirm(warehouseOwner, first)

	// The seller records its own; Root confirms for the warehouse.
	second := record(sellerOwner)
	confirm(rootInWarehouse, second)

	for _, c := range []struct {
		name               string
		id                 uint64
		recorded, accepted bool
	}{
		{"Root recorded, the owner confirmed", first, true, false},
		{"the seller recorded, Root confirmed", second, false, true},
	} {
		p := storedPayment(t, db, c.id)
		if p.RecordedIsOverride != c.recorded || p.ConfirmedIsOverride != c.accepted {
			t.Errorf("%s: recorded_is_override = %v, confirmed_is_override = %v — want %v, %v",
				c.name, p.RecordedIsOverride, p.ConfirmedIsOverride, c.recorded, c.accepted)
		}

		legs := legOverrides(t, db, c.id)
		if len(legs) != 2 || legs[0] != c.accepted || legs[1] != c.accepted {
			t.Errorf("%s: confirm legs = %v, want both %v (the confirmer's)", c.name, legs, c.accepted)
		}
	}

	var debtLegs []liability_service_models.LiabilityLog

	err := db.Where("source_id = ? AND is_override", 990_001).Find(&debtLegs).Error
	if err != nil {
		t.Fatalf("read the debt's legs: %v", err)
	}

	if len(debtLegs) != 0 {
		t.Errorf("%d legs of the caller-less posting read as an override, want none", len(debtLegs))
	}
}

// A payment request's flag FOLLOWS ITS SENDER, as requested_by_user_id does: a re-send replaces both.
func TestOverride_APaymentRequestFollowsItsSender(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	debtTo(t, svc, db, tokoA, bekasi, 700_000, 1)

	ask := func(ctx context.Context) bool {
		_, err := svc.LiabilityPaymentRequestSend(ctx, connect.NewRequest(&liabilityv1.LiabilityPaymentRequestSendRequest{
			TeamId: bekasi, DebtorTeamId: tokoA,
		}))
		if err != nil {
			t.Fatalf("ask: %v", err)
		}

		var row liability_service_models.LiabilityPaymentRequest

		err = db.Where("creditor_team_id = ? AND debtor_team_id = ?", bekasi, tokoA).Take(&row).Error
		if err != nil {
			t.Fatalf("read the request: %v", err)
		}

		return row.IsOverride
	}

	if !ask(asCaller(rootUser, bekasi, role_basev1.Role_ROLE_UNSPECIFIED)) {
		t.Error("Root's request from outside the warehouse is not marked an override")
	}

	if ask(asCaller(43, bekasi, role_basev1.Role_ROLE_WAREHOUSE_OWNER)) {
		t.Error("the owner's re-send kept Root's override mark")
	}
}

// The TERMS LOG reads the same rule (san_auth.IsOverride) as every other stamp: Root outside the creditor team is an
// override, its owner is not — and a call with no person, which used to read as an override, does not.
func TestOverride_TheTermsLogReadsTheSharedRule(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	set := func(ctx context.Context, limit int64) {
		_, err := svc.LiabilityTermsSet(ctx, connect.NewRequest(&liabilityv1.LiabilityTermsSetRequest{
			TeamId: warehouse, CounterpartyId: selling, CreditLimit: &limit, Reason: "test",
		}))
		if err != nil {
			t.Fatalf("terms set: %v", err)
		}
	}

	set(asCaller(rootUser, warehouse, role_basev1.Role_ROLE_UNSPECIFIED), 1_000)
	set(asCaller(43, warehouse, role_basev1.Role_ROLE_WAREHOUSE_OWNER), 2_000)
	set(context.Background(), 3_000)

	rows := []liability_service_models.LiabilityTermsLog{}

	err := db.Where("team_id = ? AND counterparty_id = ?", warehouse, selling).Order("id").Find(&rows).Error
	if err != nil {
		t.Fatalf("read the terms log: %v", err)
	}

	want := []bool{true, false, false}
	if len(rows) != len(want) {
		t.Fatalf("%d terms log rows, want %d", len(rows), len(want))
	}

	for i, row := range rows {
		if row.Override != want[i] {
			t.Errorf("terms log row %d: override = %v, want %v", i, row.Override, want[i])
		}
	}
}

// THE CONFIRM'S STAMP TRAVELS ON ITS EVENT: LiabilityPaymentAccepted carries `confirmed_is_override` beside
// `confirmed_by`, so the two `team_payment` rows the financial accounts post for that person say so too.
func TestOverride_TheAcceptedEventCarriesTheConfirmersStamp(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &recordingSender{}
	svc := liability_v1.NewService(db, sent.send, nil, nil)

	oweThem(t, svc, db, 30_000, 990_002)

	sellerOwner := asCaller(42, selling, role_basev1.Role_ROLE_SELLING_OWNER)

	for _, c := range []struct {
		name string
		ctx  context.Context
		want bool
	}{
		{"Root confirms from outside the warehouse", asCaller(rootUser, warehouse, role_basev1.Role_ROLE_UNSPECIFIED), true},
		{"the warehouse's own owner confirms", asCaller(43, warehouse, role_basev1.Role_ROLE_WAREHOUSE_OWNER), false},
	} {
		recorded, err := svc.LiabilityPaymentRecord(sellerOwner, connect.NewRequest(&liabilityv1.LiabilityPaymentRecordRequest{
			TeamId: selling, CreditorTeamId: warehouse, Amount: 10_000, Note: "BCA 1234",
		}))
		if err != nil {
			t.Fatalf("%s: record: %v", c.name, err)
		}

		sent.sent = nil

		_, err = svc.LiabilityPaymentConfirm(c.ctx, connect.NewRequest(&liabilityv1.LiabilityPaymentConfirmRequest{
			TeamId: warehouse, PaymentId: recorded.Msg.GetPayment().GetId(),
		}))
		if err != nil {
			t.Fatalf("%s: confirm: %v", c.name, err)
		}

		if len(sent.sent) != 1 || sent.sent[0].GetLiabilityPaymentAccepted() == nil {
			t.Fatalf("%s: published %v, want one LiabilityPaymentAccepted", c.name, sent.sent)
		}

		if got := sent.sent[0].GetLiabilityPaymentAccepted().GetActorIsOverride(); got != c.want {
			t.Errorf("%s: actor_is_override = %v, want %v", c.name, got, c.want)
		}
	}
}
