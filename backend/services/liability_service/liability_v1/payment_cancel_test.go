package liability_v1_test

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// a-pending-payment-is-cancelled-by-its-selling-team — the paying SELLING team's owner or admin takes back its own
// claim while it is pending: nothing moves, the creditor no longer has it to accept, it stays in the history marked
// cancelled, and the team may pay again.

// Two more teams for the cancel tests: another selling team, and a selling team owed by `selling` (a cross team).
const (
	cancelStranger uint64 = 3   // a selling team with no part in the payment
	cancelCross    uint64 = 404 // a selling team `selling` owes — the creditor of a cross-team payment
)

// cancelTeams is team_service as the cancel asks it: what kind of team each payer is.
func cancelTeams() *fakeNames {
	return &fakeNames{facts: map[uint64]liability_v1.TeamFact{
		selling:        {Type: teamv1.TeamType_TEAM_TYPE_SELLING},
		cancelStranger: {Type: teamv1.TeamType_TEAM_TYPE_SELLING},
		cancelCross:    {Type: teamv1.TeamType_TEAM_TYPE_SELLING},
		warehouse:      {Type: teamv1.TeamType_TEAM_TYPE_WAREHOUSE},
	}}
}

func cancelPayment(svc *liability_v1.Service, payer, paymentID uint64) (*liabilityv1.LiabilityPayment, error) {
	res, err := svc.LiabilityPaymentCancel(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityPaymentCancelRequest{
			TeamId:    payer,
			PaymentId: paymentID,
		}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetPayment(), nil
}

// awaitingPairs is the pair list's "awaiting my confirmation" filter, read as `team`.
func awaitingPairs(t *testing.T, svc *liability_v1.Service, team uint64) *liabilityv1.LiabilityPositionListResponse {
	t.Helper()

	res, err := svc.LiabilityPositionList(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityPositionListRequest{
			TeamId: team,
			Filter: &liabilityv1.LiabilityPositionListFilter{AwaitingOnly: true},
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
		}))
	if err != nil {
		t.Fatalf("LiabilityPositionList(awaiting, team=%d): %v", team, err)
	}

	return res.Msg
}

// statusOf reads a payment's stored status — the row itself, not a response that could be built from the request.
func statusOf(t *testing.T, db *gorm.DB, paymentID uint64) string {
	t.Helper()

	var status string

	err := db.
		Model(&liability_service_models.LiabilityPayment{}).
		Where("id = ?", paymentID).
		Pluck("status", &status).
		Error
	if err != nil {
		t.Fatalf("read status of %d: %v", paymentID, err)
	}

	return status
}

// paymentEntries counts the ledger rows a payment posted.
func paymentEntries(t *testing.T, db *gorm.DB, paymentID uint64) int64 {
	t.Helper()

	var entries int64

	err := db.
		Model(&liability_service_models.LiabilityLog{}).
		Where("source_type = ? AND source_id = ?", "payment", paymentID).
		Count(&entries).
		Error
	if err != nil {
		t.Fatalf("count payment entries: %v", err)
	}

	return entries
}

// THE SELLING TEAM TAKES ITS PENDING CLAIM BACK, AND NOTHING MOVES: the status is CANCELLED, the debt is what it was,
// no ledger row exists for the payment, nothing is published to the accounts (their rows post only on an accept), and
// the proof stays attached — a share is permanent (a-payment-must-carry-proof).
func TestPaymentCancel_ThePayerTakesBackAPendingPaymentAndNothingMoves(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &recordingSender{}
	svc := liability_v1.NewService(db, sent.send, bothBanks, cancelTeams())

	oweThem(t, svc, db, 15000, 1)

	payment, err := recordFrom(svc, selling, warehouse, sellingBCA, 15000)
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	got, err := cancelPayment(svc, selling, payment.GetId())
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	if got.GetStatus() != liabilityv1.LiabilityPaymentStatus_LIABILITY_PAYMENT_STATUS_CANCELLED {
		t.Fatalf("status = %v, want CANCELLED", got.GetStatus())
	}

	if stored := statusOf(t, db, payment.GetId()); stored != "cancelled" {
		t.Fatalf("stored status = %q, want \"cancelled\"", stored)
	}

	if debt := owed(t, db, selling, warehouse); debt != 15000 {
		t.Fatalf("debt = %v after cancelling, want 15000 — a cancel must post nothing", debt)
	}

	if entries := paymentEntries(t, db, payment.GetId()); entries != 0 {
		t.Fatalf("%d ledger entries for a cancelled payment, want 0", entries)
	}

	if len(sent.sent) != 0 {
		t.Fatalf("a cancel published %d events — the accounts move only on an accept", len(sent.sent))
	}

	if got.GetConfirmedBy() != 0 || got.GetConfirmedAtUnix() != 0 {
		t.Fatalf("confirmed_by = %d, confirmed_at = %d — a cancel is not a confirmation",
			got.GetConfirmedBy(), got.GetConfirmedAtUnix())
	}

	var proofs int64

	err = db.
		Model(&liability_service_models.LiabilityPaymentDocument{}).
		Where("payment_id = ?", payment.GetId()).
		Count(&proofs).
		Error
	if err != nil {
		t.Fatalf("count proof: %v", err)
	}

	if proofs != 1 {
		t.Fatalf("%d proof documents after the cancel, want the 1 attached — the proof stays", proofs)
	}
}

// THE CREDITOR NO LONGER SEES IT TO CONFIRM: its inbox (awaiting my confirmation), its badge count and the pair list's
// awaiting filter all drop the payment — and an accept or a reject of it is refused.
func TestPaymentCancel_LeavesTheCreditorsListToAccept(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, bothBanks, cancelTeams())

	oweThem(t, svc, db, 15000, 1)

	payment, err := recordFrom(svc, selling, warehouse, sellingBCA, 15000)
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	inbox := &liabilityv1.LiabilityPaymentListFilter{AwaitingMyConfirmation: true}

	if n := len(paymentList(t, svc, warehouse, inbox).GetIds()); n != 1 {
		t.Fatalf("the creditor's inbox holds %d before the cancel, want 1", n)
	}

	if n := positions(t, svc, warehouse, false).GetAwaitingConfirmation(); n != 1 {
		t.Fatalf("awaiting count = %d before the cancel, want 1", n)
	}

	_, err = cancelPayment(svc, selling, payment.GetId())
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	if ids := paymentList(t, svc, warehouse, inbox).GetIds(); len(ids) != 0 {
		t.Fatalf("the creditor's inbox still holds %v after the cancel, want none", ids)
	}

	if n := positions(t, svc, warehouse, false).GetAwaitingConfirmation(); n != 0 {
		t.Fatalf("awaiting count = %d after the cancel, want 0", n)
	}

	if ids := awaitingPairs(t, svc, warehouse).GetIds(); len(ids) != 0 {
		t.Fatalf("the pair list's awaiting filter still finds %v, want none", ids)
	}

	_, err = confirmInto(svc, warehouse, payment.GetId(), warehouseBCA)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("accepting a cancelled payment: %v, want FailedPrecondition", err)
	}

	_, err = rejectPayment(t, svc, warehouse, payment.GetId(), "too late")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("rejecting a cancelled payment: %v, want FailedPrecondition", err)
	}

	if debt := owed(t, db, selling, warehouse); debt != 15000 {
		t.Fatalf("debt = %v, want 15000 — a cancelled claim settles nothing", debt)
	}
}

// IT STAYS IN THE HISTORY, marked cancelled, on BOTH sides — a cancel is a record of what happened, never a delete.
func TestPaymentCancel_StaysInBothHistories(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, bothBanks, cancelTeams())

	oweThem(t, svc, db, 15000, 1)

	payment, err := recordFrom(svc, selling, warehouse, sellingBCA, 15000)
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	_, err = cancelPayment(svc, selling, payment.GetId())
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	for _, side := range []struct {
		team, counterparty uint64
	}{
		{selling, warehouse},
		{warehouse, selling},
	} {
		list := paymentList(t, svc, side.team, &liabilityv1.LiabilityPaymentListFilter{CounterpartyId: side.counterparty})

		var got *liabilityv1.LiabilityPayment

		for _, row := range paymentRows(list) {
			if row.GetId() == payment.GetId() {
				got = row
			}
		}

		if got == nil {
			t.Fatalf("team %d's history lost the cancelled payment %d", side.team, payment.GetId())
		}

		if got.GetStatus() != liabilityv1.LiabilityPaymentStatus_LIABILITY_PAYMENT_STATUS_CANCELLED {
			t.Fatalf("team %d reads status %v, want CANCELLED", side.team, got.GetStatus())
		}
	}
}

// THE TEAM MAY PAY AGAIN — a new claim, accepted, settles the debt; the cancelled one stays beside it.
func TestPaymentCancel_TheTeamMayPayAgain(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, bothBanks, cancelTeams())

	oweThem(t, svc, db, 15000, 1)

	wrong, err := recordFrom(svc, selling, warehouse, sellingBCA, 1500)
	if err != nil {
		t.Fatalf("record the wrong amount: %v", err)
	}

	_, err = cancelPayment(svc, selling, wrong.GetId())
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	again, err := recordFrom(svc, selling, warehouse, sellingBCA, 15000)
	if err != nil {
		t.Fatalf("paying again after a cancel was refused: %v", err)
	}

	_, err = confirmInto(svc, warehouse, again.GetId(), warehouseBCA)
	if err != nil {
		t.Fatalf("accept the new payment: %v", err)
	}

	if debt := owed(t, db, selling, warehouse); debt != 0 {
		t.Fatalf("debt = %v after the new payment was accepted, want 0", debt)
	}

	if stored := statusOf(t, db, wrong.GetId()); stored != "cancelled" {
		t.Fatalf("the cancelled claim reads %q after paying again, want \"cancelled\"", stored)
	}
}

// ONLY THE PAYING TEAM: the creditor — a selling team in a cross-team pair — and a stranger both read NOT FOUND, never
// a refusal that admits the payment exists. The claim is untouched.
func TestPaymentCancel_AnotherTeamGetsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, cancelTeams())

	owes(t, svc, db, selling, cancelCross, 15000, 1)
	payment := recordPayment(t, svc, selling, cancelCross, 15000)

	for _, team := range []uint64{cancelCross, cancelStranger} {
		_, err := cancelPayment(svc, team, payment.GetId())
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("team %d cancelling another team's payment: %v, want NotFound", team, err)
		}
	}

	if stored := statusOf(t, db, payment.GetId()); stored != "recorded" {
		t.Fatalf("status = %q after the refusals, want \"recorded\"", stored)
	}

	// The payer itself may — the cross-team creditor is a selling team too, and that changes nothing.
	_, err := cancelPayment(svc, selling, payment.GetId())
	if err != nil {
		t.Fatalf("the payer's own cancel: %v", err)
	}
}

// ONLY A PENDING PAYMENT: an accepted one is final (an-accepted-payment-is-final), a rejected one was refused, a
// cancelled one was already taken back — each answers FailedPrecondition and stays as it was.
func TestPaymentCancel_RefusesAnAcceptedARejectedOrACancelledPayment(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, bothBanks, cancelTeams())

	oweThem(t, svc, db, 30000, 1)

	accepted, err := recordFrom(svc, selling, warehouse, sellingBCA, 10000)
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	_, err = confirmInto(svc, warehouse, accepted.GetId(), warehouseBCA)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	rejected, err := recordFrom(svc, selling, warehouse, sellingBCA, 5000)
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	_, err = rejectPayment(t, svc, warehouse, rejected.GetId(), "not in our account")
	if err != nil {
		t.Fatalf("reject: %v", err)
	}

	cancelled, err := recordFrom(svc, selling, warehouse, sellingBCA, 5000)
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	_, err = cancelPayment(svc, selling, cancelled.GetId())
	if err != nil {
		t.Fatalf("first cancel: %v", err)
	}

	for _, c := range []struct {
		name   string
		id     uint64
		status string
	}{
		{"accepted", accepted.GetId(), "confirmed"},
		{"rejected", rejected.GetId(), "rejected"},
		{"cancelled", cancelled.GetId(), "cancelled"},
	} {
		_, err := cancelPayment(svc, selling, c.id)
		if connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("cancelling the %s payment: %v, want FailedPrecondition", c.name, err)
		}

		if stored := statusOf(t, db, c.id); stored != c.status {
			t.Fatalf("the %s payment reads %q after the refused cancel, want %q", c.name, stored, c.status)
		}
	}

	// The accepted 10000 still settled what it settled — the refused cancel touched nothing.
	if debt := owed(t, db, selling, warehouse); debt != 20000 {
		t.Fatalf("debt = %v, want 20000", debt)
	}
}

// NOT A WAREHOUSE PAYER — even where the policy lets the caller through (Root or the Administrator acting inside the
// warehouse): the payer's type is team_service's answer, and a warehouse's pending payment waits for its creditor.
func TestPaymentCancel_AWarehousePayerCannotCancel(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, bothBanks, cancelTeams())

	owes(t, svc, db, warehouse, selling, 15000, 1)

	payment, err := recordFrom(svc, warehouse, selling, warehouseBCA, 15000)
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	_, err = cancelPayment(svc, warehouse, payment.GetId())
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a warehouse cancelling its own payment: %v, want PermissionDenied", err)
	}

	if stored := statusOf(t, db, payment.GetId()); stored != "recorded" {
		t.Fatalf("status = %q, want \"recorded\" — the warehouse's claim still waits for its creditor", stored)
	}
}

// IT FAILS CLOSED: a payer team_service does not know is refused, never trusted to be a selling team.
func TestPaymentCancel_AnUnknownPayerIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, &fakeNames{facts: map[uint64]liability_v1.TeamFact{}})

	oweThem(t, svc, db, 15000, 1)
	payment := recordPayment(t, svc, selling, warehouse, 15000)

	_, err := cancelPayment(svc, selling, payment.GetId())
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a payer team_service does not know: %v, want PermissionDenied", err)
	}

	if stored := statusOf(t, db, payment.GetId()); stored != "recorded" {
		t.Fatalf("status = %q, want \"recorded\"", stored)
	}
}

// WHO MAY: the paying selling team's owner and admin — and Root and the Administrator, who pass every policy as an
// override. Never the CS, never a warehouse role, and never the admin team's monitor: the RPC is a WRITE, so it is not
// marked side-effect free (the-admin-team-monitors-read-only, an-agent-only-reads-for-now). The interceptor itself is
// exercised in user_service/access_interceptors (TestCancelPayment_*).
func TestPaymentCancel_OnlyTheSellingOwnerAndAdminMayCall(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.liability.v1.LiabilityPaymentCancelRequest")
	if err != nil {
		t.Fatalf("descriptor: %v", err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatal("LiabilityPaymentCancelRequest has no policy")
	}

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
	}

	got := slices.Clone(policy.GetRoles())
	slices.Sort(got)
	slices.Sort(want)

	if !slices.Equal(got, want) {
		t.Fatalf("roles = %v, want exactly %v", got, want)
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.liability.v1.LiabilityPaymentService.LiabilityPaymentCancel")
	if err != nil {
		t.Fatalf("method: %v", err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() == descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("LiabilityPaymentCancel is marked side-effect free — a monitor or an agent could call it")
	}
}
