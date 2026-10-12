//go:build raceaudit

// Concurrency audit for SupplierChannelCreate, SupplierChannelUpdate and SupplierChannelDelete — and the
// service-wide lock-order sweep (the audit-sql skill).
//
//	cd backend && go test -tags raceaudit -run 'TestRace_SupplierChannel|TestInterleave_SupplierChannel|TestRace_SupplierLockOrder' -v ./services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
)

func raceChannelCreate(ctx context.Context, db *gorm.DB, supplierID uint64, name string) error {
	_, err := raceService(db).SupplierChannelCreate(ctx, connect.NewRequest(&supplierv1.SupplierChannelCreateRequest{
		TeamId:      sellingA,
		SupplierId:  supplierID,
		ChannelType: marketplacev1.Marketplace_MARKETPLACE_OTHER,
		Name:        name,
	}))

	return err
}

func raceSupplierDelete(ctx context.Context, db *gorm.DB, supplierID uint64) error {
	_, err := raceService(db).SupplierDelete(ctx, connect.NewRequest(&supplierv1.SupplierDeleteRequest{
		TeamId: sellingA, SupplierId: supplierID,
	}))

	return err
}

func raceChannelRename(ctx context.Context, db *gorm.DB, channelID uint64, name string) error {
	_, err := raceService(db).SupplierChannelUpdate(ctx, connect.NewRequest(&supplierv1.SupplierChannelUpdateRequest{
		TeamId: sellingA, ChannelId: channelID, Name: raceStr(name),
	}))

	return err
}

func raceChannelDelete(ctx context.Context, db *gorm.DB, channelID uint64) error {
	_, err := raceService(db).SupplierChannelDelete(ctx, connect.NewRequest(&supplierv1.SupplierChannelDeleteRequest{
		TeamId: sellingA, ChannelId: channelID,
	}))

	return err
}

// ── SupplierChannelCreate vs SupplierDelete ─────────────────────────────────────────────────────────

// Seven people adding stores while one deletes the supplier, 30 rounds. Every store that was reported
// created exists; every refused one does not; nothing deadlocks; no caller sees anything but OK or NotFound.
// (A green race proves nothing about SAFETY — the two Interleaves below do.)
func TestRace_SupplierChannelCreate_VsSupplierDelete(t *testing.T) {
	h := raceHarness(t)
	ctx := context.Background()

	landed, refused := 0, 0

	for round := range 30 {
		sup := insertSupplier(t, h.DB(), sellingA, "Sumber")
		codes := make([]connect.Code, 8)

		res := h.Race(t, 8, func(i int) error {
			var err error

			if i == 3 {
				err = raceSupplierDelete(ctx, h.DB(), sup.ID)
			} else {
				err = raceChannelCreate(ctx, h.DB(), sup.ID, fmt.Sprintf("store-%d", i))
			}

			codes[i] = connect.CodeOf(err)

			return err
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Count(san_race.Deadlock) != 0 {
			t.Fatalf("round %d: %d deadlocks", round, res.Count(san_race.Deadlock))
		}

		if res.Outcomes[3].Err != nil {
			t.Fatalf("round %d: the delete failed: %v", round, res.Outcomes[3].Err)
		}

		okCreates := 0

		for i, o := range res.Outcomes {
			if i == 3 {
				continue
			}

			switch {
			case o.Err == nil:
				okCreates++
			case codes[i] == connect.CodeNotFound:
				refused++
			default:
				t.Fatalf("round %d caller %d: %v, want OK or NotFound", round, i, o.Err)
			}
		}

		landed += okCreates

		if n := raceCountChannels(t, h.DB(), sup.ID); n != int64(okCreates) {
			t.Fatalf("round %d: %d stores in the table, %d creates reported OK", round, n, okCreates)
		}

		if loadSupplier(t, h.DB(), sup.ID).DeletedAt == nil {
			t.Fatalf("round %d: supplier still live after its delete reported OK", round)
		}
	}

	t.Logf("over 30 rounds: %d creates landed before the delete, %d were refused after it", landed, refused)
}

// THE CLAIM, half one: a delete WAITS for an in-flight create. A is parked by the test between its FOR SHARE
// on the supplier and its INSERT of the store — the widest window there is. B's delete must block on that
// share lock, A's INSERT must still go through (no self-deadlock against the waiting delete), and B lands
// only after A commits.
func TestInterleave_SupplierChannelCreate_DeleteWaitsForTheCreate(t *testing.T) {
	h := raceHarness(t)
	sup := insertSupplier(t, h.DB(), sellingA, "Sumber")

	pause := raceNewPause("create", "supplier_channels")

	var waiters []raceWait

	sched := h.Interleave(t,
		san_race.Block("A", "A: ChannelCreate — FOR SHARE taken, held by the test before its INSERT",
			func(tx *gorm.DB) error {
				return raceChannelCreate(pause.into(context.Background()), tx, sup.ID, "Website")
			}),
		san_race.Block("B", "B: SupplierDelete — must wait on A's FOR SHARE", func(tx *gorm.DB) error {
			err := pause.awaitParked()
			if err != nil {
				return err
			}

			return raceSupplierDelete(context.Background(), tx, sup.ID)
		}),
		san_race.Do("C", "C: name the lock B waits on, then let A's INSERT go", func(*gorm.DB) error {
			var err error

			waiters, err = raceWaiters(h.DB())
			pause.let()

			return err
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
		san_race.Rollback("C"),
	)
	sched.Report(t)
	raceLogWaiters(t, waiters)

	a := sched.Get("A: ChannelCreate — FOR SHARE taken, held by the test before its INSERT")
	if a.Err != nil {
		t.Fatalf("A's create failed: %v", a.Err)
	}

	b := sched.Get("B: SupplierDelete — must wait on A's FOR SHARE")
	if !b.Blocked || !b.Released || b.Err != nil {
		t.Fatalf("B: blocked=%v released=%v err=%v — want blocked, released on A's commit, ok",
			b.Blocked, b.Released, b.Err)
	}

	if len(waiters) == 0 {
		t.Fatalf("nobody was waiting while A was parked — the FOR SHARE is not held")
	}

	if n := raceCountChannels(t, h.DB(), sup.ID); n != 1 {
		t.Fatalf("%d stores, want A's one", n)
	}

	final := loadSupplier(t, h.DB(), sup.ID)
	if final.DeletedAt == nil {
		t.Fatalf("supplier still live")
	}

	var createdAt string

	h.DB().Raw(`SELECT created_at::text FROM supplier_channels WHERE supplier_id = ?`, sup.ID).Scan(&createdAt)
	t.Logf("store created_at %s · supplier deleted_at %s (the delete's NOW() is its START, before it waited)",
		createdAt, final.DeletedAt.UTC().Format("2006-01-02 15:04:05.000000"))
}

// THE CLAIM, half two: a create AFTER a delete. B's delete is in flight; A's FOR SHARE waits on it, and once
// B commits Postgres re-checks `deleted_at IS NULL` on the new row version — A is NotFound, no store.
func TestInterleave_SupplierChannelCreate_AfterTheDeleteIsNotFound(t *testing.T) {
	h := raceHarness(t)
	sup := insertSupplier(t, h.DB(), sellingA, "Sumber")
	ctx := context.Background()

	sched := h.Interleave(t,
		san_race.Do("B", "B: SupplierDelete (uncommitted)", func(tx *gorm.DB) error {
			return raceSupplierDelete(ctx, tx, sup.ID)
		}),
		san_race.Block("A", "A: ChannelCreate — its FOR SHARE waits on B", func(tx *gorm.DB) error {
			return raceChannelCreate(ctx, tx, sup.ID, "Website")
		}),
		san_race.Commit("B"),
		san_race.Commit("A"),
	)
	sched.Report(t)

	a := sched.Get("A: ChannelCreate — its FOR SHARE waits on B")
	if !a.Blocked || !a.Released || connect.CodeOf(a.Err) != connect.CodeNotFound {
		t.Fatalf("A: blocked=%v released=%v err=%v — want blocked, then NotFound", a.Blocked, a.Released, a.Err)
	}

	if n := raceCountChannels(t, h.DB(), sup.ID); n != 0 {
		t.Fatalf("%d stores created on a supplier whose delete committed first", n)
	}
}

// ── SupplierChannelUpdate ──────────────────────────────────────────────────────────────────────────

// Four edits of four different fields of one store, at once, 20 rounds: all four land.
func TestRace_SupplierChannelUpdate_DifferentFieldsAllLand(t *testing.T) {
	h := raceHarness(t)
	svc := raceService(h.DB())
	ctx := context.Background()

	for round := range 20 {
		sup := insertSupplier(t, h.DB(), sellingA, "Sumber")
		ch := insertChannel(t, h.DB(), sup.ID, "other", "Website")
		shopee := marketplacev1.Marketplace_MARKETPLACE_SHOPEE

		want := [3]string{fmt.Sprintf("name-%d", round), fmt.Sprintf("https://x/%d", round), fmt.Sprintf("desc-%d", round)}

		res := h.Race(t, 4, func(i int) error {
			req := &supplierv1.SupplierChannelUpdateRequest{TeamId: sellingA, ChannelId: ch.ID}

			switch i {
			case 0:
				req.Name = raceStr(want[0])
			case 1:
				req.Uri = raceStr(want[1])
			case 2:
				req.Description = raceStr(want[2])
			case 3:
				req.ChannelType = &shopee
			}

			_, err := svc.SupplierChannelUpdate(ctx, connect.NewRequest(req))

			return err
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() != 0 {
			t.Fatalf("round %d: %d updates failed", round, res.Failed())
		}

		got := loadChannel(t, h.DB(), ch.ID)
		if got.Name != want[0] || got.URI != want[1] || got.Description != want[2] || got.ChannelType != "shopee" {
			t.Fatalf("round %d: lost an update — got %+v", round, got)
		}
	}
}

// The supplier's delete COMMITTED a moment before the store edit starts: the subquery's fresh snapshot sees
// it, the edit matches nothing, NotFound.
func TestInterleave_SupplierChannelUpdate_DeleteCommittedFirstIsNotFound(t *testing.T) {
	h := raceHarness(t)
	sup := insertSupplier(t, h.DB(), sellingA, "Sumber")
	ch := insertChannel(t, h.DB(), sup.ID, "other", "Website")
	ctx := context.Background()

	sched := h.Interleave(t,
		san_race.Do("B", "B: SupplierDelete", func(tx *gorm.DB) error { return raceSupplierDelete(ctx, tx, sup.ID) }),
		san_race.Commit("B"),
		san_race.Do("A", "A: ChannelUpdate renames the store", func(tx *gorm.DB) error {
			return raceChannelRename(ctx, tx, ch.ID, "Renamed")
		}),
		san_race.Commit("A"),
	)
	sched.Report(t)

	if a := sched.Get("A: ChannelUpdate renames the store"); connect.CodeOf(a.Err) != connect.CodeNotFound {
		t.Fatalf("A: err=%v, want NotFound", a.Err)
	}

	if got := loadChannel(t, h.DB(), ch.ID); got.Name != "Website" {
		t.Fatalf("store renamed to %q after its supplier was deleted", got.Name)
	}
}

// The supplier's delete is IN FLIGHT (uncommitted) when the store edit runs. The edit takes no lock on the
// supplier, so it does not wait: its subquery reads the last COMMITTED supplier — live — and the edit lands.
// Then the delete commits. The end state is exactly the serial order "edit, then delete": an edited store
// under a deleted supplier, hidden with it. Do, not Block: no lock is claimed here.
func TestInterleave_SupplierChannelUpdate_InFlightDeleteDoesNotStopIt(t *testing.T) {
	h := raceHarness(t)
	sup := insertSupplier(t, h.DB(), sellingA, "Sumber")
	ch := insertChannel(t, h.DB(), sup.ID, "other", "Website")
	ctx := context.Background()

	sched := h.Interleave(t,
		san_race.Do("B", "B: SupplierDelete (uncommitted)", func(tx *gorm.DB) error {
			return raceSupplierDelete(ctx, tx, sup.ID)
		}),
		san_race.Do("A", "A: ChannelUpdate renames the store — does not wait", func(tx *gorm.DB) error {
			return raceChannelRename(ctx, tx, ch.ID, "Renamed")
		}),
		san_race.Commit("B"),
		san_race.Commit("A"),
	)
	sched.Report(t)

	if a := sched.Get("A: ChannelUpdate renames the store — does not wait"); a.Err != nil {
		t.Fatalf("A: %v", a.Err)
	}

	got := loadChannel(t, h.DB(), ch.ID)
	final := loadSupplier(t, h.DB(), sup.ID)

	t.Logf("end state: store name=%q, store deleted_at=%v, supplier deleted_at set=%v",
		got.Name, got.DeletedAt, final.DeletedAt != nil)

	if got.Name != "Renamed" || final.DeletedAt == nil {
		t.Fatalf("want the serial order edit→delete: renamed store, deleted supplier")
	}
}

// The delete commits BETWEEN the edit's UPDATE and its re-read (ownLiveChannel). The re-read is a new
// statement with a new snapshot, sees the supplier gone, returns NotFound — and the error rolls the UPDATE
// back. The caller is told NotFound and the store is untouched: the serial order "delete, then edit".
func TestInterleave_SupplierChannelUpdate_DeleteBetweenUpdateAndReReadRollsBack(t *testing.T) {
	h := raceHarness(t)
	sup := insertSupplier(t, h.DB(), sellingA, "Sumber")
	ch := insertChannel(t, h.DB(), sup.ID, "other", "Website")
	ctx := context.Background()

	pause := raceNewPause("query", "supplier_channels")

	sched := h.Interleave(t,
		san_race.Block("A", "A: ChannelUpdate — UPDATE done, held by the test before its re-read",
			func(tx *gorm.DB) error {
				return raceChannelRename(pause.into(ctx), tx, ch.ID, "Renamed")
			}),
		san_race.Do("B", "B: SupplierDelete — no conflict with A's store row", func(tx *gorm.DB) error {
			err := pause.awaitParked()
			if err != nil {
				return err
			}

			return raceSupplierDelete(ctx, tx, sup.ID)
		}),
		san_race.Commit("B"),
		san_race.Do("C", "C: let A re-read", func(*gorm.DB) error {
			pause.let()
			return nil
		}),
		san_race.Commit("A"),
		san_race.Rollback("C"),
	)
	sched.Report(t)

	a := sched.Get("A: ChannelUpdate — UPDATE done, held by the test before its re-read")
	if connect.CodeOf(a.Err) != connect.CodeNotFound {
		t.Fatalf("A: err=%v, want NotFound", a.Err)
	}

	if got := loadChannel(t, h.DB(), ch.ID); got.Name != "Website" {
		t.Fatalf("A reported NotFound but its rename %q stuck", got.Name)
	}
}

// ── SupplierChannelDelete ─────────────────────────────────────────────────────────────────────────

func TestRace_SupplierChannelDelete_ExactlyOneWins(t *testing.T) {
	h := raceHarness(t)
	ctx := context.Background()

	for round := range 20 {
		sup := insertSupplier(t, h.DB(), sellingA, "Sumber")
		ch := insertChannel(t, h.DB(), sup.ID, "other", "Website")
		codes := make([]connect.Code, 8)

		res := h.Race(t, 8, func(i int) error {
			err := raceChannelDelete(ctx, h.DB(), ch.ID)
			codes[i] = connect.CodeOf(err)

			return err
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Count(san_race.None) != 1 {
			t.Fatalf("round %d: %d deletes succeeded, want 1", round, res.Count(san_race.None))
		}

		for i, o := range res.Outcomes {
			if o.Err != nil && codes[i] != connect.CodeNotFound {
				t.Fatalf("round %d caller %d: %v, want NotFound", round, i, o.Err)
			}
		}
	}
}

// An edit queued behind a store delete waits on the row, re-checks `deleted_at IS NULL`, and is NotFound.
func TestInterleave_SupplierChannelUpdate_QueuedBehindAStoreDeleteIsNotFound(t *testing.T) {
	h := raceHarness(t)
	sup := insertSupplier(t, h.DB(), sellingA, "Sumber")
	ch := insertChannel(t, h.DB(), sup.ID, "other", "Website")
	ctx := context.Background()

	sched := h.Interleave(t,
		san_race.Do("A", "A: ChannelDelete (uncommitted)", func(tx *gorm.DB) error {
			return raceChannelDelete(ctx, tx, ch.ID)
		}),
		san_race.Block("B", "B: ChannelUpdate — waits on A's row lock", func(tx *gorm.DB) error {
			return raceChannelRename(ctx, tx, ch.ID, "Renamed")
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	b := sched.Get("B: ChannelUpdate — waits on A's row lock")
	if !b.Blocked || connect.CodeOf(b.Err) != connect.CodeNotFound {
		t.Fatalf("B: blocked=%v err=%v — want blocked, then NotFound", b.Blocked, b.Err)
	}

	if got := loadChannel(t, h.DB(), ch.ID); got.Name != "Website" || got.DeletedAt == nil {
		t.Fatalf("store name=%q deleted=%v — want untouched and deleted", got.Name, got.DeletedAt != nil)
	}
}

// ── The lock-order sweep ────────────────────────────────────────────────────────────────────────────

// Every write handler at once on ONE supplier and ONE of its stores, 40 rounds: the two tables are taken in
// every order the handlers allow (suppliers→channels by a create, channels-then-a-read-of-suppliers by a
// store edit/delete, suppliers alone by an update/delete). A cycle would show as a 40P01.
func TestRace_SupplierLockOrder_EveryWriterAtOnceNeverDeadlocks(t *testing.T) {
	h := raceHarness(t)
	ctx := context.Background()

	deadlocks := 0

	for round := range 40 {
		sup := insertSupplier(t, h.DB(), sellingA, "Sumber")
		ch := insertChannel(t, h.DB(), sup.ID, "other", "Website")
		codes := make([]connect.Code, 8)

		res := h.Race(t, 8, func(i int) error {
			var err error

			switch i {
			case 0, 1:
				err = raceChannelCreate(ctx, h.DB(), sup.ID, fmt.Sprintf("store-%d", i))
			case 2:
				_, err = raceService(h.DB()).SupplierUpdate(ctx, connect.NewRequest(&supplierv1.SupplierUpdateRequest{
					TeamId: sellingA, SupplierId: sup.ID, Name: raceStr("renamed"),
				}))
			case 3:
				_, err = raceService(h.DB()).SupplierUpdate(ctx, connect.NewRequest(&supplierv1.SupplierUpdateRequest{
					TeamId: sellingA, SupplierId: sup.ID, Contact: raceStr("0812"),
				}))
			case 4:
				err = raceChannelRename(ctx, h.DB(), ch.ID, "renamed")
			case 5:
				err = raceChannelDelete(ctx, h.DB(), ch.ID)
			case 6:
				err = raceSupplierDelete(ctx, h.DB(), sup.ID)
			case 7:
				err = raceChannelCreate(ctx, h.DB(), sup.ID, "store-7")
			}

			codes[i] = connect.CodeOf(err)

			return err
		})

		if round == 0 {
			res.Report(t)
		}

		deadlocks += res.Count(san_race.Deadlock)

		for i, o := range res.Outcomes {
			if o.Err != nil && codes[i] != connect.CodeNotFound {
				t.Fatalf("round %d caller %d: %v (%s), want OK or NotFound", round, i, o.Err, o.Kind)
			}
		}
	}

	if deadlocks != 0 {
		t.Fatalf("%d deadlocks over 40 rounds", deadlocks)
	}
}
