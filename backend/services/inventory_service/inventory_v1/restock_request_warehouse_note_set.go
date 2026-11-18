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

// RestockRequestWarehouseNoteSet writes the RECEIVING WAREHOUSE's own note on a restock (the-warehouse-writes-its-own-note:
// "bisa mengubah catatan warehouse"). Its one writer is the warehouse (three-notes-one-writer-each,
// the-notes-are-one-per-writer), so it is scoped to warehouse_id, as signing for the box is: another team's restock — the
// selling team that raised it included — reads NotFound. The selling team's note is RestockRequestNoteSet's, never this.
//
// FROM WHICH STATUS the warehouse may write it is NOT decided (the owner: not his call), so this refuses no status: the
// warehouse's restock page offers its Ubah in every status, and the note is taken in every status.
//
// Nothing but the warehouse's note moves: the selling note, the lines and the money stay as stored, so no money event is
// sent. A note equal to the stored one is no change: nothing is written, and the note keeps its writer. A changed note
//
//   - stamps its OWN writer and time on the restock (the-notes-are-one-per-writer), and
//   - is an edit's row on the trail, the status unchanged, with ONE change under it — the warehouse note before and
//     after (edits-are-in-the-same-trail, restock_log_changes.go).
//
// The row is loaded FOR UPDATE — the lock every other write of a restock takes — so two warehouse note sets, or one
// beside an edit, an accept or a cancel, queue, and the note, its writer and the trail's before/after never disagree.
func (s *Service) RestockRequestWarehouseNoteSet(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestWarehouseNoteSetRequest],
) (*connect.Response[inventoryv1.RestockRequestWarehouseNoteSetResponse], error) {
	note := req.Msg.GetNote()
	actor := actorFrom(ctx)
	override := overrideFrom(ctx)

	var rr inventory_service_models.Restock

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND warehouse_id = ?", req.Msg.GetRequestId(), req.Msg.GetTeamId()).
			First(&rr).
			Error
		if loadErr != nil {
			return loadErr
		}

		if rr.WarehouseNote != note {
			setErr := setRestockWarehouseNote(tx, &rr, note, actor, override, time.Now())
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

	return connect.NewResponse(&inventoryv1.RestockRequestWarehouseNoteSetResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}

// setRestockWarehouseNote writes a CHANGED warehouse note on the restock `rr` (held FOR UPDATE by the caller): the note,
// its writer and time, then the edit's trail row with the note's before and after under it — all in the caller's
// transaction.
func setRestockWarehouseNote(
	tx *gorm.DB,
	rr *inventory_service_models.Restock,
	note string,
	actor uint64,
	override bool,
	at time.Time,
) error {
	changes := []inventory_service_models.RestockLogChange{{
		Field:       restockChangeWarehouseNote,
		BeforeValue: rr.WarehouseNote,
		AfterValue:  note,
	}}

	rr.WarehouseNote = note
	rr.WarehouseNoteByUserID = actor
	rr.WarehouseNoteByIsOverride = override
	rr.WarehouseNoteAt = &at

	// A map, not the struct: clearing the note IS the change, and a struct update skips a zero value.
	updErr := tx.
		Model(rr).
		Updates(map[string]any{
			"warehouse_note":                rr.WarehouseNote,
			"warehouse_note_by_user_id":     rr.WarehouseNoteByUserID,
			"warehouse_note_by_is_override": rr.WarehouseNoteByIsOverride,
			"warehouse_note_at":             rr.WarehouseNoteAt,
			"updated_at":                    at,
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
