-- +goose Up
-- +goose StatementBegin

-- WHO WROTE THE SELLING TEAM'S NOTE, AND WHEN (the-notes-are-one-per-writer, docs/technical/frontend/restock_decision.md).
-- `restocks.note` is the selling team's note on the restock as a whole (three-notes-one-writer-each); until now nothing
-- said who wrote it, so the pages showed the restock's last raise or edit instead — which may have changed only a line.
-- These three columns are the note's OWN author and time, written by inventory_v1 in the same transaction as the note:
--   * at the RAISE, by whoever raised it — the note is written then, empty or not;
--   * by an edit (RestockRequestUpdate) or a note set (RestockRequestNoteSet, the-note-is-edited-in-any-status) that
--     CHANGES the note — and never by one that changes only a line, the resi or the money.
--
--   * `note_by_user_id` — an opaque user_service id, no FK, like `created_by_user_id`; 0 = not recorded.
--   * `note_by_is_override` — the writer was Root or the Administrator acting in a team they hold no role in
--     (an-override-is-stamped-in-every-service), so the by-line can carry the shared badge.
--   * `note_at` — NULL = not recorded.
--
-- NO BACKFILL. A restock raised before this migration had its note written by SOMEBODY, but inventing an id here would
-- put a real person's name against words they may not have typed. Its columns stay 0 / false / NULL, and the screens fall
-- back to the restock's last raise or edit, said as that.
ALTER TABLE restocks
    ADD COLUMN note_by_user_id     BIGINT      NOT NULL DEFAULT 0 CHECK (note_by_user_id >= 0),
    ADD COLUMN note_by_is_override BOOLEAN     NOT NULL DEFAULT false,
    ADD COLUMN note_at             TIMESTAMPTZ;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE restocks
    DROP COLUMN note_at,
    DROP COLUMN note_by_is_override,
    DROP COLUMN note_by_user_id;
-- +goose StatementEnd
