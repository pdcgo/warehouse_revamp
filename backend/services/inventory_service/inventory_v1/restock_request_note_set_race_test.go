//go:build raceaudit

// Concurrency audit for RestockRequestNoteSet — the selling team's note written alone, in any status
// (the-note-is-edited-in-any-status), with its own writer and time (the-notes-are-one-per-writer) and an edit's row on the
// trail (edits-are-in-the-same-trail). Two people on one restock at the same second is the normal case here: two writers
// of the note, or a note written while a colleague saves the edit form. The note set takes the restock row FOR UPDATE —
// the lock Update, Arrive, Accept, MarkLost and Cancel take — so whatever the order, the stored note, its writer and the
// trail's before/after must tell one story.
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS. The seed and the table list are
// restock_request_supplier_race_test.go's.
//
//	go test -tags raceaudit -p 1 -count=1 -run 'TestRace_RestockRequestNoteSet' -v ./backend/services/inventory_service/inventory_v1/
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

// raceNoteSeed commits one ONGOING restock of the race team with `note` on it, paid from an account (an ongoing edit
// requires one) — returning its id.
func raceNoteSeed(t *testing.T, db *gorm.DB, note string) uint64 {
	t.Helper()

	created, err := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, nil, nil).RestockRequestCreate(ctxUser(1),
		connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: raceRestockTeam, WarehouseId: raceRestockWarehouse, FinanceAccountId: 41, Note: note,
			Items: raceRestockItems(),
		}))
	if err != nil {
		t.Fatalf("seed restock: %v", err)
	}

	return created.Msg.GetRequest().GetId()
}

// raceNoteRow is one note change as the trail stores it, with the row that carries it.
type raceNoteRow struct {
	LogID  uint64
	Actor  uint64
	At     time.Time
	Before string
	After  string
}

// raceNoteState is the restock's note, its writer and time, and every note change on its trail in the order written.
func raceNoteState(t *testing.T, db *gorm.DB, id uint64) (note string, by uint64, at *time.Time, rows []raceNoteRow) {
	t.Helper()

	var head struct {
		Note         string
		NoteByUserID uint64
		NoteAt       *time.Time
	}

	err := db.
		Raw(`SELECT note, note_by_user_id, note_at FROM restocks WHERE id = ?`, id).
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
		     WHERE l.restock_id = ? AND c.field = 'note'
		     ORDER BY l.id, c.id`, id).
		Scan(&rows).
		Error
	if err != nil {
		t.Fatalf("read trail: %v", err)
	}

	return head.Note, head.NoteByUserID, head.NoteAt, rows
}

// raceNoteTellsOneStory is the end state every race must leave: the note changes chain — each one's before is the
// previous one's after, the first starts from `seeded` and the last ends on the stored note — and the stored writer and
// time are the last change's row. With no change at all, the note is the seeded one and its writer the raiser.
func raceNoteTellsOneStory(t *testing.T, db *gorm.DB, id uint64, seeded string) []raceNoteRow {
	t.Helper()

	note, by, at, rows := raceNoteState(t, db, id)

	if len(rows) == 0 {
		if note != seeded || by != 1 {
			t.Fatalf("no note change on the trail, yet the note reads %q by %d (seeded %q by 1)", note, by, seeded)
		}

		return rows
	}

	prev := seeded
	for i, r := range rows {
		if r.Before != prev {
			t.Fatalf("note change %d starts from %q, want %q (the one before it ended there): %+v", i, r.Before, prev, rows)
		}

		prev = r.After
	}

	last := rows[len(rows)-1]
	if note != last.After {
		t.Fatalf("the stored note %q is not the trail's last change %q: %+v", note, last.After, rows)
	}

	if by != last.Actor || at == nil || !at.Equal(last.At) {
		t.Fatalf("the note reads written by %d at %v, want the last change's %d at %v", by, at, last.Actor, last.At)
	}

	return rows
}

// EIGHT PEOPLE WRITE ONE RESTOCK'S NOTE AT ONCE: every write lands, one after another under the row's lock — eight
// changes on the trail, each from the note the one before left, and the stored note names its own writer.
func TestRace_RestockRequestNoteSet_ManyWritersOneStory(t *testing.T) {
	h := san_race.New(t, raceRestockTables...)
	svc := inventory_v1.NewService(h.DB(), nil, nil, nil, nil, nil, nil, nil, nil, nil)

	const writers = 8

	for round := range 5 {
		id := raceNoteSeed(t, h.DB(), "awal")

		res := h.Race(t, writers, func(i int) error {
			_, err := svc.RestockRequestNoteSet(ctxUser(uint64(100+i)), connect.NewRequest(&inventoryv1.RestockRequestNoteSetRequest{
				TeamId: raceRestockTeam, RequestId: id, Note: fmt.Sprintf("catatan %d", i),
			}))

			return err
		})
		res.Name = fmt.Sprintf("round %d", round)

		if res.Failed() != 0 {
			res.Report(t)
			t.Fatalf("round %d: %d of %d note writes failed", round, res.Failed(), writers)
		}

		rows := raceNoteTellsOneStory(t, h.DB(), id, "awal")
		if len(rows) != writers {
			t.Fatalf("round %d: %d note changes on the trail, want %d", round, len(rows), writers)
		}

		for _, r := range rows {
			if want := fmt.Sprintf("catatan %d", r.Actor-100); r.After != want {
				t.Fatalf("round %d: the row by %d says it wrote %q, want %q", round, r.Actor, r.After, want)
			}
		}
	}
}

// A NOTE WRITTEN WHILE A COLLEAGUE SAVES THE EDIT FORM — which sends the note it read, unchanged, with a line changed.
// Whichever lands second, the stored note, its writer and the trail agree: the form saved after the note set puts its
// note back and is its writer (the form is a full replace, a-restock-is-edited-only-while-ongoing); saved before, it
// changed no note and the note set's writer stands. Both orders are hit.
func TestRace_RestockRequestNoteSet_RacingTheEditFormKeepsOneStory(t *testing.T) {
	h := san_race.New(t, raceRestockTables...)
	svc := inventory_v1.NewService(h.DB(), nil, nil, nil, nil, nil, nil, nil, nil, nil)

	var formLast, noteLast int

	for round := range 12 {
		id := raceNoteSeed(t, h.DB(), "awal")

		res := h.Race(t, 2, func(i int) error {
			if i == 0 {
				_, err := svc.RestockRequestNoteSet(ctxUser(201), connect.NewRequest(&inventoryv1.RestockRequestNoteSetRequest{
					TeamId: raceRestockTeam, RequestId: id, Note: "baru",
				}))

				return err
			}

			// Both orders: the form waits a little more each round.
			time.Sleep(time.Duration(round%4) * time.Millisecond)

			items := raceRestockItems()
			items[0].Count = 2
			items[0].Total = 200

			_, err := svc.RestockRequestUpdate(ctxUser(202), connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
				TeamId: raceRestockTeam, RequestId: id, WarehouseId: raceRestockWarehouse, FinanceAccountId: 41,
				Note: "awal", Items: items,
			}))

			return err
		})
		res.Name = fmt.Sprintf("round %d", round)

		if res.Failed() != 0 {
			res.Report(t)
			t.Fatalf("round %d: %d of 2 writes failed", round, res.Failed())
		}

		rows := raceNoteTellsOneStory(t, h.DB(), id, "awal")

		note, by, _, _ := raceNoteState(t, h.DB(), id)
		switch {
		case note == "awal" && by == 202 && len(rows) == 2:
			formLast++
		case note == "baru" && by == 201 && len(rows) == 1:
			noteLast++
		default:
			t.Fatalf("round %d: the note reads %q by %d with %d changes — neither order", round, note, by, len(rows))
		}
	}

	t.Logf("the form saved last in %d rounds, the note set in %d", formLast, noteLast)
}
