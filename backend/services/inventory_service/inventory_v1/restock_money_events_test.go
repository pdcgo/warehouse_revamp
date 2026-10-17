package inventory_v1_test

import (
	"context"
	"errors"
	"strconv"
	"testing"

	"connectrpc.com/connect"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE RESTOCK'S MONEY EVENTS (a-created-restock-tells-the-financial-account, an-edit-sends-the-difference,
// an-edit-may-move-the-payment-to-another-account, a-restock-names-its-paying-account): raised, edited in a way that
// moves money, and called off — each announced to whoever posts the payment, after its commit.

// sentEvents records what the service published, in order.
type sentEvents struct {
	events []*eventsv1.Event
	fail   error
}

func (s *sentEvents) send(_ context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
	s.events = append(s.events, event)

	return s.fail
}

func moneyService(t *testing.T, sent *sentEvents) *inventory_v1.Service {
	t.Helper()

	return inventory_v1.NewService(san_testdb.DB(t), nil, nil, fakeSuppliers{arrMelati: true, arrSinar: true}, sent.send)
}

// Raised: goods 250.000 + shipping 20.000 left account 7 — never the courier's charge, which comes later and is the
// warehouse's.
func TestRestockMoneyEvents_CreateAnnouncesTheAmountPaid(t *testing.T) {
	sent := &sentEvents{}
	svc := moneyService(t, sent)

	raised := arrRaise(t, svc)

	if len(sent.events) != 1 {
		t.Fatalf("%d events after create, want 1", len(sent.events))
	}

	got := sent.events[0].GetRestockCreated()
	if got == nil {
		t.Fatalf("the create published %T, want RestockCreated", sent.events[0].GetMessage())
	}

	if got.GetRestockId() != raised.GetId() || got.GetTeamId() != arrSellingTeam || got.GetWarehouseId() != arrWarehouse ||
		got.GetFinanceAccountId() != arrAccount || got.GetAmount() != 270000 || got.GetActorId() != arrBuyer {
		t.Fatalf("RestockCreated = %+v, want restock %d, team %d, warehouse %d, account %d, 270000, by %d",
			got, raised.GetId(), arrSellingTeam, arrWarehouse, arrAccount, arrBuyer)
	}

	if want := "restock-created:" + idText(raised.GetId()); sent.events[0].GetEventId() != want {
		t.Fatalf("event id %q, want %q — derived, so a republish dedups", sent.events[0].GetEventId(), want)
	}
}

// An edit sends what moved: a changed amount carries old and new, a moved account carries both accounts, and an edit
// that moves no money — a note — sends nothing.
func TestRestockMoneyEvents_AnEditSendsOnlyWhatMovedMoney(t *testing.T) {
	sent := &sentEvents{}
	svc := moneyService(t, sent)

	raised := arrRaise(t, svc)

	edit := func(mutate func(*inventoryv1.RestockRequestUpdateRequest)) {
		t.Helper()

		req := &inventoryv1.RestockRequestUpdateRequest{
			TeamId: arrSellingTeam, RequestId: raised.GetId(),
			WarehouseId: arrWarehouse, FinanceAccountId: arrAccount, Receipt: "SCP123", ShipmentCost: 20000,
			Items: arrLines(),
		}
		mutate(req)

		_, err := svc.RestockRequestUpdate(ctxUser(arrBuyer), connect.NewRequest(req))
		if err != nil {
			t.Fatalf("update: %v", err)
		}
	}

	sent.events = nil
	edit(func(r *inventoryv1.RestockRequestUpdateRequest) { r.Note = "urgent, for the sale" })

	if len(sent.events) != 0 {
		t.Fatalf("a note-only edit published %d events, want none", len(sent.events))
	}

	edit(func(r *inventoryv1.RestockRequestUpdateRequest) { r.Items[0].Count, r.Items[0].Total = 12, 120000 })

	if len(sent.events) != 1 {
		t.Fatalf("an edit that raised the amount published %d events, want 1", len(sent.events))
	}

	up := sent.events[0].GetRestockUpdated()
	if up.GetOldAmount() != 270000 || up.GetNewAmount() != 290000 ||
		up.GetOldFinanceAccountId() != arrAccount || up.GetNewFinanceAccountId() != arrAccount {
		t.Fatalf("RestockUpdated = %+v, want 270000 → 290000 on account %d", up, arrAccount)
	}

	sent.events = nil
	edit(func(r *inventoryv1.RestockRequestUpdateRequest) {
		r.Items[0].Count, r.Items[0].Total = 12, 120000
		r.FinanceAccountId = 8
	})

	moved := sent.events[0].GetRestockUpdated()
	if len(sent.events) != 1 || moved.GetOldFinanceAccountId() != arrAccount || moved.GetNewFinanceAccountId() != 8 ||
		moved.GetOldAmount() != 290000 || moved.GetNewAmount() != 290000 {
		t.Fatalf("moving the account published %v, want one RestockUpdated %d → 8 at 290000", sent.events, arrAccount)
	}
}

// Called off: the amount, and whether the money came back.
func TestRestockMoneyEvents_CancelSaysWhetherTheMoneyCameBack(t *testing.T) {
	sent := &sentEvents{}
	svc := moneyService(t, sent)

	raised := arrRaise(t, svc)
	sent.events = nil

	_, err := svc.RestockRequestCancel(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
		TeamId: arrSellingTeam, RequestId: raised.GetId(), MoneyReturned: true,
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	got := sent.events[0].GetRestockCancelled()
	if len(sent.events) != 1 || got.GetAmount() != 270000 || !got.GetMoneyReturned() ||
		got.GetFinanceAccountId() != arrAccount || got.GetActorId() != arrBuyer {
		t.Fatalf("RestockCancelled = %+v, want 270000 returned to account %d by %d", got, arrAccount, arrBuyer)
	}
}

// A FAILED PUBLISH NEVER FAILS THE RESTOCK (no-outbox-the-publish-is-trusted): the row is committed, and the listener
// is short this restock until a replay.
func TestRestockMoneyEvents_AFailedPublishDoesNotFailTheCreate(t *testing.T) {
	sent := &sentEvents{fail: errors.New("broker unreachable")}
	svc := moneyService(t, sent)

	raised := arrRaise(t, svc)

	if raised.GetId() == 0 || len(sent.events) != 1 {
		t.Fatalf("create with a broken broker: restock %d, %d publish attempts — want a restock and one attempt",
			raised.GetId(), len(sent.events))
	}
}

func idText(id uint64) string {
	return strconv.FormatUint(id, 10)
}
