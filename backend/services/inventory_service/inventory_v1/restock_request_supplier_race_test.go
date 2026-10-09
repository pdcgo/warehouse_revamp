//go:build raceaudit

// Concurrency audit for the restock path's question to supplier_service (the audit-sql skill):
// RestockRequestCreate and RestockRequestUpdate ask SupplierChecker.SupplierIsLive — a network RPC in
// production — from INSIDE their database transaction. Does that matter?
//
// Helpers here carry a `raceRestock` prefix so they cannot collide with the other build-tagged files.
//
//	cd backend && go test -tags raceaudit -run 'TestRace_RestockRequest|TestInterleave_RestockRequest' -v ./services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// The tables this audit writes, CHILDREN FIRST.
var raceRestockTables = []string{
	"restock_request_events",
	"restock_cost_lines",
	"restock_request_items",
	"restock_requests",
	"warehouse_products",
	"supplier_channels",
	"suppliers",
}

const (
	raceRestockTeam      uint64 = 2
	raceRestockWarehouse uint64 = 5
)

func raceRestockItems() []*inventoryv1.RestockRequestItem {
	return []*inventoryv1.RestockRequestItem{{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 1, Total: 100}}
}

// raceRestockItemsFrom is the same line naming a supplier — the supplier rides each line
// (a-line-connects-to-any-teams-supplier-from-a-popup), and the handler asks supplier_service about it.
func raceRestockItemsFrom(supplierID uint64) []*inventoryv1.RestockRequestItem {
	items := raceRestockItems()
	items[0].SupplierId = supplierID

	return items
}

// raceRestockSeed commits one ONGOING restock naming no supplier — so seeding never asks the checker.
func raceRestockSeed(t *testing.T, db *gorm.DB) uint64 {
	t.Helper()

	created, err := inventory_v1.NewService(db, nil, nil, nil, nil).RestockRequestCreate(ctxUser(1),
		connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: raceRestockTeam, WarehouseId: raceRestockWarehouse, Items: raceRestockItems(),
		}))
	if err != nil {
		t.Fatalf("seed restock: %v", err)
	}

	return created.Msg.GetRequest().GetId()
}

func raceRestockStatusAndSupplier(t *testing.T, db *gorm.DB, id uint64) (string, *uint64) {
	t.Helper()

	var row struct {
		Status     string
		SupplierID *uint64
	}

	err := db.Raw(`SELECT status, supplier_id FROM restock_requests WHERE id = ?`, id).Scan(&row).Error
	if err != nil {
		t.Fatalf("read restock %d: %v", id, err)
	}

	return row.Status, row.SupplierID
}

// raceRestockParkedSuppliers stands in for supplier_service: the call parks until release, which is how a
// network round-trip looks from inside the transaction. `during`, if set, runs at the start of the call
// (on the caller's goroutine) and records what the database looks like while the question is in flight.
type raceRestockParkedSuppliers struct {
	live    map[uint64]bool
	latency time.Duration // instead of release, if set
	called  chan struct{}
	release chan struct{}
	once    sync.Once
	during  func()
}

func raceRestockNewParked(live map[uint64]bool) *raceRestockParkedSuppliers {
	return &raceRestockParkedSuppliers{live: live, called: make(chan struct{}), release: make(chan struct{})}
}

func (f *raceRestockParkedSuppliers) SupplierIsLive(_ context.Context, _, supplierID uint64) (bool, error) {
	if f.during != nil {
		f.during()
	}

	f.once.Do(func() { close(f.called) })

	if f.latency > 0 {
		time.Sleep(f.latency)
	} else {
		<-f.release
	}

	return f.live[supplierID], nil
}

func (f *raceRestockParkedSuppliers) awaitCalled() error {
	select {
	case <-f.called:
		return nil
	case <-time.After(5 * time.Second):
		return errors.New("the handler never asked supplier_service")
	}
}

// raceRestockRealSuppliers answers SupplierIsLive from the REAL supplier_service handler — exactly the
// composition root's adapter (SupplierByIds, a deleted supplier is not live) — then parks before returning
// the answer, so a delete can land between the answer and the restock's INSERT.
type raceRestockRealSuppliers struct {
	svc      *supplier_v1.Service
	answered chan struct{}
	release  chan struct{}
}

func (f *raceRestockRealSuppliers) SupplierIsLive(ctx context.Context, teamID, supplierID uint64) (bool, error) {
	resp, err := f.svc.SupplierByIds(ctx, connect.NewRequest(&supplierv1.SupplierByIdsRequest{
		TeamId: teamID,
		Filter: &supplierv1.SupplierByIdsFilter{Ids: []uint64{supplierID}},
	}))
	if err != nil {
		return false, err
	}

	live := false

	for _, item := range resp.Msg.GetItems()[supplierID].GetItems() {
		if s := item.GetSupplier().GetMapData()[supplierID]; s != nil {
			live = !s.GetDeleted()
		}
	}

	close(f.answered)
	<-f.release

	return live, nil
}

// raceRestockHeldLocks reports, while a question to supplier_service is in flight, how many backends of this
// database sit IDLE IN TRANSACTION and how many row/relation/xid locks those backends hold.
func raceRestockHeldLocks(db *gorm.DB) (idleInTx int64, locks int64, err error) {
	err = db.Raw(`
		SELECT COUNT(*) FROM pg_stat_activity
		WHERE datname = current_database() AND state = 'idle in transaction'`).Scan(&idleInTx).Error
	if err != nil {
		return 0, 0, err
	}

	err = db.Raw(`
		SELECT COUNT(*) FROM pg_locks l
		JOIN pg_stat_activity a ON a.pid = l.pid
		WHERE a.datname = current_database() AND a.state = 'idle in transaction'
		  AND l.locktype NOT IN ('virtualxid')`).Scan(&locks).Error

	return idleInTx, locks, err
}

// ── RestockRequestUpdate: the supplier is asked BEFORE the row is locked ────────────────────────────────
//
// The audit (audits/services/inventory_service/concurrency/RestockRequestUpdate.md) found the request held
// FOR UPDATE across the call to supplier_service: a cancel — or a warehouse accepting the delivery — waited
// out a network round-trip with no timeout. Fixed the same day: the supplier is asked before the transaction
// and the answer judged under the lock. These pin the fix.

// supplier_service takes 800 ms to answer; a cancel of the same request arriving 50 ms into that does NOT wait
// it out. The update, resuming after the answer, then finds the request cancelled — the serial outcome of
// "cancel, then edit" — and refuses with FailedPrecondition rather than editing a cancelled request.
func TestRace_RestockRequestUpdate_ACancelDoesNotWaitForTheSupplierRoundTrip(t *testing.T) {
	h := san_race.New(t, raceRestockTables...)
	reqID := raceRestockSeed(t, h.DB())

	const (
		newSupplier uint64 = 31
		latency            = 800 * time.Millisecond
	)

	slow := raceRestockNewParked(map[uint64]bool{newSupplier: true})
	slow.latency = latency

	updater := inventory_v1.NewService(h.DB(), nil, nil, slow, nil)
	canceller := inventory_v1.NewService(h.DB(), nil, nil, nil, nil)
	ctx := ctxUser(1)

	res := h.Race(t, 2, func(i int) error {
		if i == 0 {
			_, err := updater.RestockRequestUpdate(ctx, connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
				TeamId: raceRestockTeam, RequestId: reqID, WarehouseId: raceRestockWarehouse,
				Items: raceRestockItemsFrom(newSupplier),
			}))

			return err
		}

		err := slow.awaitCalled()
		if err != nil {
			return err
		}

		time.Sleep(50 * time.Millisecond)

		_, err = canceller.RestockRequestCancel(ctx,
			connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{TeamId: raceRestockTeam, RequestId: reqID}))

		return err
	})
	res.Report(t)

	cancel := res.Outcomes[1]
	update := res.Outcomes[0]

	t.Logf("update took %v (%v) · cancel took %v (%v) — supplier_service latency %v",
		update.Wall.Round(time.Millisecond), update.Err, cancel.Wall.Round(time.Millisecond), cancel.Err, latency)

	if cancel.Err != nil {
		t.Fatalf("cancel: %v", cancel.Err)
	}

	if cancel.Wall > latency/2 {
		t.Fatalf("cancel took %v — it waited on the supplier round-trip", cancel.Wall)
	}

	if connect.CodeOf(update.Err) != connect.CodeFailedPrecondition {
		t.Fatalf("the update after a committed cancel = %v, want FailedPrecondition", update.Err)
	}

	status, _ := raceRestockStatusAndSupplier(t, h.DB(), reqID)
	t.Logf("end state: status=%s", status)
}

// ── RestockRequestCreate: the supplier is asked before the transaction ─────────────────────────────────

// While supplier_service is being asked, the create has not opened its transaction at all: no backend idle in
// transaction, no pinned connection, no lock.
func TestRace_RestockRequestCreate_HoldsNoTransactionDuringTheSupplierCall(t *testing.T) {
	h := san_race.New(t, raceRestockTables...)

	const supplier uint64 = 31

	var (
		idleInTx, locks int64
		probeErr        error
	)

	probe := raceRestockNewParked(map[uint64]bool{supplier: true})
	probe.latency = time.Millisecond
	probe.during = func() {
		idleInTx, locks, probeErr = raceRestockHeldLocks(h.DB())
	}

	_, err := inventory_v1.NewService(h.DB(), nil, nil, probe, nil).RestockRequestCreate(ctxUser(1),
		connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: raceRestockTeam, WarehouseId: raceRestockWarehouse, Items: raceRestockItemsFrom(supplier),
		}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if probeErr != nil {
		t.Fatalf("probe: %v", probeErr)
	}

	t.Logf("during the supplier call: %d backend(s) idle in transaction, holding %d lock(s) beyond their own vxid",
		idleInTx, locks)

	if idleInTx != 0 || locks != 0 {
		t.Fatalf("the create holds a transaction (%d) or locks (%d) across the supplier call", idleInTx, locks)
	}
}

// The cross-service check-then-act, forced: supplier_service says "live", then the supplier is deleted (and
// that delete commits) before the restock's INSERT. No lock can span two services, so the restock commits
// naming a supplier deleted a moment earlier. The question this answers is whether that state is one the
// system does not already allow — it is the same state as "restock first, delete after", which
// TestRestockRequest_UpdateKeepsDeletedSupplierItAlreadyHad treats as valid.
func TestInterleave_RestockRequestCreate_SupplierDeletedWhileTheAnswerIsInFlight(t *testing.T) {
	h := san_race.New(t, raceRestockTables...)

	var supplierID uint64

	err := h.DB().Raw(`INSERT INTO suppliers (team_id, name) VALUES (12, 'Sumber') RETURNING id`).Scan(&supplierID).Error
	if err != nil {
		t.Fatalf("seed supplier: %v", err)
	}

	answering := &raceRestockRealSuppliers{
		svc:      supplier_v1.NewService(h.DB(), nil, nil),
		answered: make(chan struct{}),
		release:  make(chan struct{}),
	}

	ctx := ctxUser(1)

	sched := h.Interleave(t,
		san_race.Block("A", "A: RestockRequestCreate names the supplier — supplier_service says live, the answer is in flight",
			func(tx *gorm.DB) error {
				_, err := inventory_v1.NewService(tx, nil, nil, answering, nil).RestockRequestCreate(ctx,
					connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
						TeamId: raceRestockTeam, WarehouseId: raceRestockWarehouse,
						Items: raceRestockItemsFrom(supplierID),
					}))

				return err
			}),
		san_race.Do("B", "B: SupplierDelete in supplier_service (team 12)", func(tx *gorm.DB) error {
			select {
			case <-answering.answered:
			case <-time.After(5 * time.Second):
				return errors.New("supplier_service was never asked")
			}

			_, err := supplier_v1.NewService(tx, nil, nil).SupplierDelete(ctx, connect.NewRequest(&supplierv1.SupplierDeleteRequest{
				TeamId: 12, SupplierId: supplierID,
			}))

			return err
		}),
		san_race.Commit("B"),
		san_race.Do("C", "C: the answer arrives", func(*gorm.DB) error {
			close(answering.release)
			return nil
		}),
		san_race.Commit("A"),
		san_race.Rollback("C"),
	)
	sched.Report(t)

	a := sched.Get("A: RestockRequestCreate names the supplier — supplier_service says live, the answer is in flight")
	if a.Err != nil {
		t.Fatalf("A: %v", a.Err)
	}

	var row struct {
		RestockCreated  time.Time
		SupplierDeleted time.Time
		RestockSupplier uint64
	}

	err = h.DB().Raw(`
		SELECT r.created_at AS restock_created, s.deleted_at AS supplier_deleted, r.supplier_id AS restock_supplier
		FROM restock_requests r JOIN suppliers s ON s.id = r.supplier_id
		WHERE r.supplier_id = ?`, supplierID).Scan(&row).Error
	if err != nil {
		t.Fatalf("read end state: %v", err)
	}

	t.Logf("end state: a restock naming supplier %d, created %s — the supplier was deleted %s (%v earlier)",
		row.RestockSupplier, row.RestockCreated.UTC().Format(time.RFC3339Nano),
		row.SupplierDeleted.UTC().Format(time.RFC3339Nano), row.RestockCreated.Sub(row.SupplierDeleted).Round(time.Millisecond))

	if row.RestockSupplier != supplierID {
		t.Fatalf("expected the restock to commit naming the supplier — the window was not hit")
	}
}
