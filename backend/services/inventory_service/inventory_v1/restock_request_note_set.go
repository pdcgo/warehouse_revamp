package inventory_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockRequestNoteSet writes the SELLING team's note on its own restock — the note alone, in EVERY status (owner:
// "catatan bisa diedit kapanpun", the-note-is-edited-in-any-status): on its way, at the door, and once accepted, lost or
// cancelled. Its one writer is the selling team (three-notes-one-writer-each), so it is scoped to the RAISING team:
// another team's restock — the receiving warehouse's included — reads NotFound, as for Update.
//
// Nothing but the note moves: the restock's other fields, its lines and its money stay as stored, so no money event is
// sent (an-edit-sends-the-difference has nothing to send). A note equal to the stored one is no change: nothing is
// written, and the note keeps its writer. A changed note
//
//   - stamps its OWN writer and time on the restock (the-notes-are-one-per-writer, stampNote), and
//   - is an edit's row on the trail, the status unchanged, with ONE change under it — the note before and after
//     (edits-are-in-the-same-trail, restock_log_changes.go) — exactly what an edit form's note change writes.
//
// The row is loaded FOR UPDATE — the lock Update, Arrive, Accept, MarkLost and Cancel take — so a note set and an edit of
// the same restock queue, and the note, its writer and the trail's before/after can never disagree.
func (s *Service) RestockRequestNoteSet(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestNoteSetRequest],
) (*connect.Response[inventoryv1.RestockRequestNoteSetResponse], error) {
	note := req.Msg.GetNote()
	actor := actorFrom(ctx)
	override := overrideFrom(ctx)

	var rr inventory_service_models.Restock

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND team_id = ?", req.Msg.GetRequestId(), req.Msg.GetTeamId()).
			First(&rr).
			Error
		if loadErr != nil {
			return loadErr
		}

		if rr.Note != note {
			setErr := setRestockNote(tx, &rr, note, actor, override, time.Now())
			if setErr != nil {
				return setErr
			}
		}

		return tx.
			Where("restock_id = ?", rr.ID).
			Order("id").
			Find(&rr.Items).
			Error
	})
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestNoteSetResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}

// setRestockNote writes a CHANGED note on the restock `rr` (held FOR UPDATE by the caller): the note, its writer and
// time, then the edit's trail row with the note's before and after under it — all in the caller's transaction.
func setRestockNote(
	tx *gorm.DB,
	rr *inventory_service_models.Restock,
	note string,
	actor uint64,
	override bool,
	at time.Time,
) error {
	changes := []inventory_service_models.RestockLogChange{{
		Field:       restockChangeNote,
		BeforeValue: rr.Note,
		AfterValue:  note,
	}}

	rr.Note = note
	stampNote(rr, actor, override, at)

	// A map, not the struct: clearing the note IS the change, and a struct update skips a zero value.
	updErr := tx.
		Model(rr).
		Updates(map[string]any{
			"note":                rr.Note,
			"note_by_user_id":     rr.NoteByUserID,
			"note_by_is_override": rr.NoteByIsOverride,
			"note_at":             rr.NoteAt,
			"updated_at":          at,
		}).
		Error
	if updErr != nil {
		return updErr
	}

	row, logErr := recordRestockLogRow(tx, rr.ID, rr.Status, rr.Status, actor, override, restockLogEdited, at)
	if logErr != nil {
		return logErr
	}

	return recordRestockLogChanges(tx, row.ID, changes)
}

// stampNote records who wrote the restock's note, and when (the-notes-are-one-per-writer) — on the model only; the
// caller writes it with the note. Called where the note is WRITTEN: at the raise, and by an edit or a note set that
// changes it — never by a write that leaves the note as it was.
func stampNote(rr *inventory_service_models.Restock, actor uint64, override bool, at time.Time) {
	rr.NoteByUserID = actor
	rr.NoteByIsOverride = override
	rr.NoteAt = &at
}
