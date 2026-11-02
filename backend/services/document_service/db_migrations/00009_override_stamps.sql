-- +goose Up
-- AN OVERRIDE IS STAMPED (docs/business/user/context_decision.md#an-override-is-stamped-in-every-service): a file
-- uploaded, or a share granted, by Root or the Administrator inside a team they hold no role in — in by the root-team
-- bypass, not a membership — says so beside the actor it records, so a team can see what the platform put among its
-- files and whom it let read them. Derived from the access interceptor's resolved role (san_auth.IsOverride), never sent
-- by the caller.
--
--   documents        the uploader (created_by_id), at RequestUpload.
--   document_shares  the granter (granted_by). A share is made in the OWNER's scope, so the flag is about the owner
--                    team, never about the team the share opens the file to.
--
-- Every existing row reads FALSE: nothing recorded the fact before this column, so nothing can be claimed about them.
ALTER TABLE documents       ADD COLUMN is_override BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE document_shares ADD COLUMN is_override BOOLEAN NOT NULL DEFAULT FALSE;

-- +goose Down
ALTER TABLE document_shares DROP COLUMN is_override;
ALTER TABLE documents       DROP COLUMN is_override;
