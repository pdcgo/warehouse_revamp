//go:build raceaudit

// Concurrency audit for RestockRequestWarehouseNoteSet — the receiving warehouse's own note
// (the-warehouse-writes-its-own-note), kept with its own writer and time (the-notes-are-one-per-writer) and an edit's row
// on the trail (edits-are-in-the-same-trail). Two people on one restock at the same second is the normal case: two
// warehouse members writing the note, or the warehouse writing its note while the selling team writes ITS note or saves
// the edit form. The note set takes the restock row FOR UPDATE — the lock every other restock write takes — so whatever
// the order, the warehouse note, its writer and the trail's before/after must tell one story, and neither team's write
// may replace the other's note (three-notes-one-writer-each).
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS. The seed and the table list are
// restock_request_note_set_race_test.go's (raceNoteSeed) and restock_request_supplier_race_test.go's.
//
//	go test -tags raceaudit -p 1 -count=1 -run 'TestRace_RestockRequestWarehouseNoteSet' -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// raceWarehouseNoteState is the restock's warehouse note, its writer and time, and every warehouse-note change on its
// trail in the order written.
func raceWarehouseNoteState(t *testing.T, db *gorm.DB, id uint64) (note string, by uint64, at *time.Time, rows []raceNoteRow) {
	t.Helper()

	var head struct {
		WarehouseNote         string
		WarehouseNoteByUserID uint64
		WarehouseNoteAt       *time.Time
	}

	err := db.
		Raw(`SELECT warehouse_note, warehouse_note_by_user_id, warehouse_note_at FROM restocks WHERE id = ?`, id).
		Scan(&head).
		Error
	if err != nil {
		t.Fatalf("read restock: %v", err)
	}

	err = db.
		Raw(`SELECT l.id AS log_id, l.actor_user_id AS actor, l.created_at AS at,
		            c.before_value AS before, c.after_value AS after
		     FROM restock_logs l
		     JOIN restock_log_changes c ON c.restock_log_id = l.id
		     WHERE l.restock_id = ? AND c.field = 'warehouse_note'
		     ORDER BY l.id, c.id`, id).
		Scan(&rows).
		Error
	if err != nil {
		t.Fatalf("read trail: %v", err)
	}

	return head.WarehouseNote, head.WarehouseNoteByUserID, head.WarehouseNoteAt, rows
}

// raceWarehouseNoteTellsOneStory is the end state every race must leave: the warehouse-note changes chain from "" — each
// one's before is the previous one's after — the last ends on the stored note, and the stored writer and time are the
// last change's row.
func raceWarehouseNoteTellsOneStory(t *testing.T, db *gorm.DB, id uint64) []raceNoteRow {
	t.Helper()

	note, by, at, rows := raceWarehouseNoteState(t, db, id)

	if len(rows) == 0 {
		if note != "" || by != 0 || at != nil {
			t.Fatalf("no warehouse note change on the trail, yet the note reads %q by %d at %v", note, by, at)
		}

		return rows
	}

	prev := ""
	for i, r := range rows {
		if r.Before != prev {
			t.Fatalf("warehouse note change %d starts from %q, want %q (the one before it ended there): %+v", i, r.Before, prev, rows)
		}

		prev = r.After
	}

	last := rows[len(rows)-1]
	if note != last.After {
		t.Fatalf("the stored warehouse note %q is not the trail's last change %q: %+v", note, last.After, rows)
	}

	if by != last.Actor || at == nil || !at.Equal(last.At) {
		t.Fatalf("the warehouse note reads written by %d at %v, want the last change's %d at %v", by, at, last.Actor, last.At)
	}

	return rows
}

// EIGHT WAREHOUSE MEMBERS WRITE ONE RESTOCK'S NOTE AT ONCE: every write lands, one after another under the row's lock —
// eight changes on the trail, each from the note the one before left, and the stored note names its own writer.
func TestRace_RestockRequestWarehouseNoteSet_ManyWritersOneStory(t *testing.T) {
	h := san_race.New(t, raceRestockTables...)
	svc := inventory_v1.NewService(h.DB(), nil, nil, nil, nil, nil, nil, nil, nil, nil)

	const writers = 8

	for round := range 5 {
		id := raceNoteSeed(t, h.DB(), "awal")

		res := h.Race(t, writers, func(i int) error {
			_, err := svc.RestockRequestWarehouseNoteSet(ctxUser(uint64(300+i)),
				connect.NewRequest(&inventoryv1.RestockRequestWarehouseNoteSetRequest{
					TeamId: raceRestockWarehouse, RequestId: id, Note: fmt.Sprintf("gudang %d", i),
				}))

			return err
		})
		res.Name = fmt.Sprintf("round %d", round)

		if res.Failed() != 0 {
			res.Report(t)
			t.Fatalf("round %d: %d of %d warehouse note writes failed", round, res.Failed(), writers)
		}

		rows := raceWarehouseNoteTellsOneStory(t, h.DB(), id)
		if len(rows) != writers {
			t.Fatalf("round %d: %d warehouse note changes on the trail, want %d", round, len(rows), writers)
		}

		for _, r := range rows {
			if want := fmt.Sprintf("gudang %d", r.Actor-300); r.After != want {
				t.Fatalf("round %d: the row by %d says it wrote %q, want %q", round, r.Actor, r.After, want)
			}
		}
	}
}

// ONE WRITER EACH, AT THE SAME SECOND (three-notes-one-writer-each): the warehouse writes its note while the selling
// team writes its own note AND, beside it, saves the edit form (a full replace of the restock and its lines). Whatever
// the order, neither note replaces the other: the warehouse note is the warehouse's write by the warehouse's member, the
// selling note tells its own story, and every write lands. Both orders are hit.
func TestRace_RestockRequestWarehouseNoteSet_TheTwoTeamsNeverReplaceEachOther(t *testing.T) {
	h := san_race.New(t, raceRestockTables...)
	svc := inventory_v1.NewService(h.DB(), nil, nil, nil, nil, nil, nil, nil, nil, nil)

	var warehouseFirst, warehouseLater int

	for round := range 12 {
		id := raceNoteSeed(t, h.DB(), "awal")

		res := h.Race(t, 3, func(i int) error {
			switch i {
			case 0:
				// Both orders: on odd rounds the warehouse waits, on even rounds the selling team does.
				if round%2 == 1 {
					time.Sleep(time.Duration(1+round%3) * time.Millisecond)
				}

				_, err := svc.RestockRequestWarehouseNoteSet(ctxUser(401), connect.NewRequest(&inventoryv1.RestockRequestWarehouseNoteSetRequest{
					TeamId: raceRestockWarehouse, RequestId: id, Note: "kardus penyok",
				}))

				return err
			case 1:
				if round%2 == 0 {
					time.Sleep(time.Duration(1+round%3) * time.Millisecond)
				}

				_, err := svc.RestockRequestNoteSet(ctxUser(402), connect.NewRequest(&inventoryv1.RestockRequestNoteSetRequest{
					TeamId: raceRestockTeam, RequestId: id, Note: "baru",
				}))

				return err
			default:
				if round%2 == 0 {
					time.Sleep(time.Duration(1+round%3) * time.Millisecond)
				}

				items := raceRestockItems()
				items[0].Count = 2
				items[0].Total = 200

				_, err := svc.RestockRequestUpdate(ctxUser(403), connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
					TeamId: raceRestockTeam, RequestId: id, WarehouseId: raceRestockWarehouse, FinanceAccountId: 41,
					Note: "awal", Items: items,
				}))

				return err
			}
		})
		res.Name = fmt.Sprintf("round %d", round)

		if res.Failed() != 0 {
			res.Report(t)
			t.Fatalf("round %d: %d of 3 writes failed", round, res.Failed())
		}

		rows := raceWarehouseNoteTellsOneStory(t, h.DB(), id)
		note, by, _, _ := raceWarehouseNoteState(t, h.DB(), id)

		if len(rows) != 1 || note != "kardus penyok" || by != 401 {
			t.Fatalf("round %d: the warehouse note reads %q by %d with %d changes — want the warehouse's, once", round, note, by, len(rows))
		}

		// The selling note's own story holds too (its chain, its writer — the note set's or the form's, by order).
		raceNoteTellsOneStory(t, h.DB(), id, "awal")

		// Which side of the selling writes the warehouse's landed on: its row's place in the trail.
		var before int64

		err := h.DB().
			Raw(`SELECT count(*) FROM restock_logs WHERE restock_id = ? AND id < ? AND from_status <> ''`, id, rows[0].LogID).
			Scan(&before).
			Error
		if err != nil {
			t.Fatalf("round %d: read trail: %v", round, err)
		}

		if before == 0 {
			warehouseFirst++
		} else {
			warehouseLater++
		}
	}

	t.Logf("the warehouse's note landed first in %d rounds, after a selling write in %d", warehouseFirst, warehouseLater)
}
