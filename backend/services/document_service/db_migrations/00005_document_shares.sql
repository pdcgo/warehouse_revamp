-- +goose Up
-- +goose StatementBegin
-- ONE DOCUMENT, ONE OTHER TEAM THAT MAY READ IT (a-payment-must-carry-proof).
--
-- ⚠ WHY A TABLE RATHER THAN A RULE. A payment's proof is uploaded by the payer and has to be read by
-- the creditor, and `GetDownloadUrl` scopes every read to the owning team on purpose. The alternative
-- was an internal signing path that skipped that check and let another service decide who may read —
-- which makes one bug in one service's relation check a leak of every private file in the system.
--
-- This keeps the invariant instead: THERE IS NO READ WITHOUT A ROW SAYING YOU MAY. The row is granted
-- by the document's OWNER, in their own scope, so no service ever asks another for permission and
-- document_service never learns what a payment is.
CREATE TABLE document_shares (
    id          BIGSERIAL   PRIMARY KEY,

    -- The document, and the team that may now read it. No FK on team_id: teams belong to another
    -- service, exactly as `documents.team_id` already does.
    document_id TEXT        NOT NULL REFERENCES documents (id) ON DELETE RESTRICT,
    team_id     BIGINT      NOT NULL,

    -- WHO GRANTED IT, opaque user id. A share is somebody's act, and the file it opens is evidence in
    -- an argument about money — "who let them see this" has to be answerable.
    granted_by  BIGINT      NOT NULL,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ⚠ ON DELETE RESTRICT ABOVE IS THE POINT, not a default. A shared document CANNOT be hard-deleted:
-- the creditor accepted or rejected a payment by looking at it, and evidence for a decision somebody
-- may be asked about later cannot be withdrawn by the party who supplied it.

-- Granting twice is the same fact, not two of them — a retried client must not double-write.
CREATE UNIQUE INDEX document_shares_unique ON document_shares (document_id, team_id);

-- The read path: "may team X read document D". One index answers it.
CREATE INDEX document_shares_team_idx ON document_shares (team_id, document_id);

-- A PAYMENT'S PROOF is a named resource type rather than a `general` document, so the table says what
-- the file IS. Private: a transfer slip names an account number, which is not something to serve from
-- a URL that works for anyone who ever holds it.
--
-- ⚠ The CHECK must list every value resourceTypeToText() can produce, or an upload of a newly-added
-- type fails at INSERT. Adding a resource type means touching the proto enum, resourceTypeToText/
-- FromText, isPublic AND this constraint — they must stay in sync.
ALTER TABLE documents DROP CONSTRAINT documents_resource_type_valid;
ALTER TABLE documents ADD CONSTRAINT documents_resource_type_valid
    CHECK (resource_type IN ('general', 'profile_picture', 'product_image', 'order_receipt', 'payment_proof'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE documents DROP CONSTRAINT documents_resource_type_valid;
ALTER TABLE documents ADD CONSTRAINT documents_resource_type_valid
    CHECK (resource_type IN ('general', 'profile_picture', 'product_image', 'order_receipt'));

DROP TABLE document_shares;
-- +goose StatementEnd
