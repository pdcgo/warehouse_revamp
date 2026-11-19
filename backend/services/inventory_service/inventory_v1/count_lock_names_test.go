package inventory_v1_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1/inventoryv1connect"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A COUNT REFUSAL NAMES THE PERSON WHO STARTED THE COUNT (backlog #90, an-abandoned-count-waits-for-the-admin: *"a
// blocked action names the session, who started it and when"* — *"started by Ani, Fri 17:00"*). Budi (43) starts a count
// of Kaos Hitam on Rak A and Rak B; what it blocks says *started by Budi Santoso*, never *user #43*:
//
//	the cancel's check (StockLockCheck, in process — the seller's toast on OrderCancel)   CountedError
//	deleting Rak A, over HTTP through the mounted handlers (register.go's interceptor)    RackCountedError
//	a move off Rak A, over HTTP                                                           CountedError, by a mapper
//	an order wanting more than the free racks hold (OrderTransactionCreate, in process)   CountedLinesError
//	a return put away onto Rak A (OrderTransactionReturn, in process — the return accept)  CountedError
//	a second count of the warehouse while this one is active                              the session's own refusal
//
// The when stays as it was (the refusal's date and time in WIB). A name that cannot be read leaves the user id.

const cnBudi = "Budi Santoso"

// cnService is the opname fixture's service with the user read wired — the export store's UserNames, the one by-id
// user read this service names people with. `people` nil is a store that knows nobody.
func cnService(f *opnameFixture, people map[uint64]string) *inventory_v1.Service {
	return inventory_v1.NewService(f.db, f.poster, f.expense, nil, nil, opFacts(), nil, nil, nil,
		&fakeRestockExports{people: people})
}

// cnServer mounts the service the way the app does — inventory_service.NewRegister — behind a stand-in for the shared
// chain that leaves Budi, the warehouse Admin, on every request, as the access interceptor would.
func cnServer(t *testing.T, svc *inventory_v1.Service) (inventoryv1connect.RackServiceClient, func()) {
	t.Helper()

	asBudi := connect.UnaryInterceptorFunc(func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			ctx = san_auth.WithIdentity(ctx, &role_basev1.Identity{IdentityId: opBudi})
			ctx = san_auth.WithScope(ctx, otWarehouse)
			ctx = san_auth.WithCallerRole(ctx, role_basev1.Role_ROLE_WAREHOUSE_ADMIN)

			return next(ctx, req)
		}
	})

	mux := http.NewServeMux()
	inventory_service.NewRegister(mux, svc, connect.WithInterceptors(asBudi))()

	server := httptest.NewServer(mux)

	return inventoryv1connect.NewRackServiceClient(server.Client(), server.URL), server.Close
}

// cnNamed fails unless the refusal names Budi by name — and not by id — with the when beside it.
func cnNamed(t *testing.T, what string, msg string) {
	t.Helper()

	if !strings.Contains(msg, "started by "+cnBudi+" at ") || strings.Contains(msg, "user #") || !strings.Contains(msg, " WIB") {
		t.Errorf("%s: %q — want it to name %q and when, not a user id", what, msg, cnBudi)
	}
}

func TestCountRefusal_NamesWhoStartedTheCount(t *testing.T) {
	f := opnameStocked(t)
	svc := cnService(f, map[uint64]string{opBudi: cnBudi})
	f.svc = svc

	took, err := orderKaosHitam(f, "K-named", 1)
	if err != nil {
		t.Fatalf("take: %v", err)
	}

	s := countKaosHitam(t, f)

	// THE CANCEL'S CHECK — in process; selling puts lock.Error() in the seller's toast.
	lock, err := svc.StockLockCheck(context.Background(), otMelati, otWarehouse, "K-named")
	if err != nil || lock == nil || lock.SessionID != s.GetId() {
		t.Fatalf("under the count: lock %+v, err %v — want count #%d", lock, err, s.GetId())
	}

	cnNamed(t, "the cancel's check", lock.Error())

	// OVER HTTP, as the app mounts it — the rack a count holds, and a move off it.
	racks, done := cnServer(t, svc)
	defer done()

	_, err = racks.RackDelete(context.Background(), connect.NewRequest(&inventoryv1.RackDeleteRequest{
		TeamId: otWarehouse, RackId: f.rakA,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("deleting Rak A under the count: %v, want FailedPrecondition", err)
	}

	cnNamed(t, "deleting Rak A", err.Error())

	_, err = racks.RackMove(context.Background(), connect.NewRequest(&inventoryv1.RackMoveRequest{
		TeamId: otWarehouse, FromRackId: f.rakA,
		Lines: []*inventoryv1.RackMoveLine{{ProductId: otKaosHitam, Quantity: 1, ToRackId: f.rakC}},
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a move off Rak A under the count: %v, want FailedPrecondition", err)
	}

	cnNamed(t, "a move off Rak A", err.Error())

	// THE ORDER'S TAKE — in process; every free unit is under the count, so the take is refused line by line.
	_, err = orderKaosHitam(f, "K-named-2", 5)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a take the free racks cannot fill: %v, want FailedPrecondition", err)
	}

	cnNamed(t, "the order's take", err.Error())

	// THE RETURN ACCEPT — in process; the parcel's unit put away onto the rack the count holds.
	_, err = svc.OrderTransactionReturn(ctxUser(rtCrew), connect.NewRequest(&inventoryv1.OrderTransactionReturnRequest{
		TeamId: otWarehouse, SellingTeamId: otMelati, TakeTransactionId: took.Msg.GetTransactionId(),
		Lines: []*inventoryv1.OrderTransactionReturnLine{rtLine(otKaosHitam, otKaosHitam, 0, 1, 0, 0, f.rakA)},
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a return onto Rak A under the count: %v, want FailedPrecondition", err)
	}

	cnNamed(t, "the return accept", err.Error())

	// A SECOND COUNT WHILE THIS ONE IS ACTIVE — the session row's own refusal.
	_, err = svc.OpnameSessionCreate(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameSessionCreateRequest{
		TeamId: otWarehouse, Plan: inventoryv1.OpnamePlan_OPNAME_PLAN_ALL,
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a second count: %v, want FailedPrecondition", err)
	}

	cnNamed(t, "a second count", err.Error())
}

// A NAME THAT CANNOT BE READ LEAVES THE USER ID — no user read wired, or one that knows nobody: the refusal still names
// the count, who by id, and when, as it always did.
func TestCountRefusal_WithNoNameNamesTheUserID(t *testing.T) {
	for _, c := range []struct {
		name   string
		people map[uint64]string
		wired  bool
	}{
		{"no user read wired", nil, false},
		{"a user read that knows nobody", map[uint64]string{}, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			f := opnameStocked(t)
			if c.wired {
				f.svc = cnService(f, c.people)
			}

			_, err := orderKaosHitam(f, "K-unnamed", 1)
			if err != nil {
				t.Fatalf("take: %v", err)
			}

			countKaosHitam(t, f)

			lock, err := f.svc.StockLockCheck(context.Background(), otMelati, otWarehouse, "K-unnamed")
			if err != nil || lock == nil {
				t.Fatalf("under the count: lock %+v, err %v", lock, err)
			}

			if msg := lock.Error(); !strings.Contains(msg, "started by user #43 at ") {
				t.Errorf("the cancel's check: %q — want the user id", msg)
			}

			racks, done := cnServer(t, f.svc)
			defer done()

			_, err = racks.RackDelete(context.Background(), connect.NewRequest(&inventoryv1.RackDeleteRequest{
				TeamId: otWarehouse, RackId: f.rakA,
			}))
			if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "started by user #43 at ") {
				t.Errorf("deleting Rak A: %v — want FailedPrecondition naming the user id", err)
			}
		})
	}
}
