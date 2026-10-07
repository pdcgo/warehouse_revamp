//go:build raceaudit

// Concurrency audit for SupplierCreate, SupplierUpdate and SupplierDelete (the audit-sql skill).
//
//	cd backend && go test -tags raceaudit -run 'TestRace_Supplier[CUD]|TestInterleave_Supplier[UD]' -v ./services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// SupplierCreate is a bare INSERT after a team_service question asked OUTSIDE any transaction. There is no
// existence check (a name is not unique — the-supplier-has-no-code), so there is no phantom to race:
// n creates make n rows.
func TestRace_SupplierCreate_EveryCallerGetsItsRow(t *testing.T) {
	h := raceHarness(t)
	svc := raceService(h.DB())

	res := h.Race(t, 8, func(i int) error {
		_, err := svc.SupplierCreate(context.Background(), connect.NewRequest(&supplierv1.SupplierCreateRequest{
			TeamId: sellingA,
			Name:   "Sumber",
		}))

		return err
	})
	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d creates failed", res.Failed())
	}

	if n := countRows(t, h.DB(), &supplier_service_models.Supplier{}); n != 8 {
		t.Fatalf("%d suppliers after 8 creates, want 8", n)
	}
}

// Four people correcting four DIFFERENT fields of one supplier at the same second: every field lands. One
// UPDATE with a column map — nobody reads the row and writes it back whole.
func TestRace_SupplierUpdate_DifferentFieldsAllLand(t *testing.T) {
	h := raceHarness(t)
	svc := raceService(h.DB())
	ctx := context.Background()

	for round := range 20 {
		sup := insertSupplier(t, h.DB(), sellingA, "Sumber")

		want := [4]string{
			fmt.Sprintf("name-%d", round),
			fmt.Sprintf("contact-%d", round),
			fmt.Sprintf("address-%d", round),
			fmt.Sprintf("desc-%d", round),
		}

		res := h.Race(t, 4, func(i int) error {
			req := &supplierv1.SupplierUpdateRequest{TeamId: sellingA, SupplierId: sup.ID}

			switch i {
			case 0:
				req.Name = raceStr(want[0])
			case 1:
				req.Contact = raceStr(want[1])
			case 2:
				req.Address = raceStr(want[2])
			case 3:
				req.Description = raceStr(want[3])
			}

			_, err := svc.SupplierUpdate(ctx, connect.NewRequest(req))

			return err
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() != 0 {
			t.Fatalf("round %d: %d updates failed", round, res.Failed())
		}

		got := loadSupplier(t, h.DB(), sup.ID)
		if got.Name != want[0] || got.Contact != want[1] || got.Address != want[2] || got.Description != want[3] {
			t.Fatalf("round %d: lost an update — got %+v, want %v", round, got, want)
		}
	}
}

// The proof behind the race above: B's UPDATE WAITS on A's row lock, and once released it writes only its
// own column — A's name survives, and B's reply (a re-read in its own transaction) shows both.
func TestInterleave_SupplierUpdate_SecondWaitsAndKeepsBoth(t *testing.T) {
	h := raceHarness(t)
	sup := insertSupplier(t, h.DB(), sellingA, "Sumber")
	ctx := context.Background()

	var replyB *supplierv1.Supplier

	sched := h.Interleave(t,
		san_race.Do("A", "A sets the name (uncommitted)", func(tx *gorm.DB) error {
			_, err := raceService(tx).SupplierUpdate(ctx, connect.NewRequest(&supplierv1.SupplierUpdateRequest{
				TeamId: sellingA, SupplierId: sup.ID, Name: raceStr("Sumber Jaya"),
			}))

			return err
		}),
		san_race.Block("B", "B sets the contact — waits on A's row lock", func(tx *gorm.DB) error {
			resp, err := raceService(tx).SupplierUpdate(ctx, connect.NewRequest(&supplierv1.SupplierUpdateRequest{
				TeamId: sellingA, SupplierId: sup.ID, Contact: raceStr("0812"),
			}))
			if err == nil {
				replyB = resp.Msg.GetSupplier()
			}

			return err
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	b := sched.Get("B sets the contact — waits on A's row lock")
	if !b.Blocked || !b.Released || b.Err != nil {
		t.Fatalf("B: blocked=%v released=%v err=%v — want blocked, released, ok", b.Blocked, b.Released, b.Err)
	}

	got := loadSupplier(t, h.DB(), sup.ID)
	if got.Name != "Sumber Jaya" || got.Contact != "0812" {
		t.Fatalf("final row name=%q contact=%q — one update was lost", got.Name, got.Contact)
	}

	if replyB.GetName() != "Sumber Jaya" || replyB.GetContact() != "0812" {
		t.Fatalf("B's reply name=%q contact=%q — want both edits", replyB.GetName(), replyB.GetContact())
	}
}

// An update racing a delete: the update's `deleted_at IS NULL` is RE-EVALUATED after it waits, so an edit
// queued behind a delete is NotFound, never an edit of a deleted supplier.
func TestInterleave_SupplierUpdate_QueuedBehindADeleteIsNotFound(t *testing.T) {
	h := raceHarness(t)
	sup := insertSupplier(t, h.DB(), sellingA, "Sumber")
	ctx := context.Background()

	sched := h.Interleave(t,
		san_race.Do("B", "B deletes the supplier (uncommitted)", func(tx *gorm.DB) error {
			_, err := raceService(tx).SupplierDelete(ctx, connect.NewRequest(&supplierv1.SupplierDeleteRequest{
				TeamId: sellingA, SupplierId: sup.ID,
			}))

			return err
		}),
		san_race.Block("A", "A renames it — waits on B's row lock", func(tx *gorm.DB) error {
			_, err := raceService(tx).SupplierUpdate(ctx, connect.NewRequest(&supplierv1.SupplierUpdateRequest{
				TeamId: sellingA, SupplierId: sup.ID, Name: raceStr("Too Late"),
			}))

			return err
		}),
		san_race.Commit("B"),
		san_race.Commit("A"),
	)
	sched.Report(t)

	a := sched.Get("A renames it — waits on B's row lock")
	if !a.Blocked || connect.CodeOf(a.Err) != connect.CodeNotFound {
		t.Fatalf("A: blocked=%v err=%v — want blocked, then NotFound", a.Blocked, a.Err)
	}

	got := loadSupplier(t, h.DB(), sup.ID)
	if got.Name != "Sumber" || got.DeletedAt == nil {
		t.Fatalf("final name=%q deleted_at=%v — want the original name, deleted", got.Name, got.DeletedAt)
	}
}

// Eight deletes of one supplier at once: exactly one succeeds, seven are NotFound.
func TestRace_SupplierDelete_ExactlyOneWins(t *testing.T) {
	h := raceHarness(t)
	svc := raceService(h.DB())
	ctx := context.Background()

	for round := range 20 {
		sup := insertSupplier(t, h.DB(), sellingA, "Sumber")
		codes := make([]connect.Code, 8)

		res := h.Race(t, 8, func(i int) error {
			_, err := svc.SupplierDelete(ctx, connect.NewRequest(&supplierv1.SupplierDeleteRequest{
				TeamId: sellingA, SupplierId: sup.ID,
			}))
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

		if loadSupplier(t, h.DB(), sup.ID).DeletedAt == nil {
			t.Fatalf("round %d: supplier still live", round)
		}
	}
}

// The second delete waits on the first, re-evaluates `deleted_at IS NULL` and matches nothing — so
// deleted_at is written ONCE and never moved by a late duplicate.
func TestInterleave_SupplierDelete_SecondIsNotFoundAndDeletedAtStays(t *testing.T) {
	h := raceHarness(t)
	sup := insertSupplier(t, h.DB(), sellingA, "Sumber")
	ctx := context.Background()

	var deletedByA time.Time

	del := func(tx *gorm.DB) error {
		_, err := raceService(tx).SupplierDelete(ctx, connect.NewRequest(&supplierv1.SupplierDeleteRequest{
			TeamId: sellingA, SupplierId: sup.ID,
		}))

		return err
	}

	sched := h.Interleave(t,
		san_race.Do("A", "A deletes", del),
		san_race.Do("A", "A reads its own deleted_at", func(tx *gorm.DB) error {
			return tx.Raw(`SELECT deleted_at FROM suppliers WHERE id = ?`, sup.ID).Scan(&deletedByA).Error
		}),
		san_race.Block("B", "B deletes too — waits on A", del),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	b := sched.Get("B deletes too — waits on A")
	if !b.Blocked || connect.CodeOf(b.Err) != connect.CodeNotFound {
		t.Fatalf("B: blocked=%v err=%v — want blocked, then NotFound", b.Blocked, b.Err)
	}

	final := loadSupplier(t, h.DB(), sup.ID)
	if final.DeletedAt == nil || !final.DeletedAt.Equal(deletedByA) {
		t.Fatalf("deleted_at = %v, want A's %v — the late delete moved it", final.DeletedAt, deletedByA)
	}
}
