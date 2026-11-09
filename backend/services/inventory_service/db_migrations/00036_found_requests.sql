-- +goose Up
-- +goose StatementBegin
-- A FOUND AT THE SHELF WAITS FOR THE OWNER OR ADMIN (docs/business/inventory/opname_decision.md —
-- an-adjust-found-waits-for-the-owner-or-admin, accepted with its screens in the-found-stock-prototype-is-accepted).
-- FoundRequestCreate writes ONE row here and posts nothing (staff-may-report-a-found — StockAdjust refuses FOUND); its
-- approval posts one `found` transaction through the stock count's own claim and mint
-- (inventory_mutations.PostFoundApproval); its rejection — or the reporter's withdrawal — posts nothing; a count that
-- finalizes over its product on its rack settles it — the count posted the units it found
-- (a-count-settles-the-found-it-counted).
--
-- `team_id` is the product's owner (product_service), whose loss is claimed and whose batch is minted.
-- `product_code` / `product_name` are snapshots taken at the report, as a count's rows are. Every *_id but the
-- in-service ones is another service's: no FK.
CREATE TABLE found_requests (
    id                             BIGSERIAL PRIMARY KEY,
    warehouse_id                   BIGINT      NOT NULL CHECK (warehouse_id > 0),
    team_id                        BIGINT      NOT NULL CHECK (team_id > 0),
    product_id                     BIGINT      NOT NULL CHECK (product_id > 0),
    product_code                   TEXT        NOT NULL DEFAULT '',
    product_name                   TEXT        NOT NULL DEFAULT '',
    -- Every unit is on a rack (there-is-no-unplaced-pile).
    placement_id                   BIGINT      NOT NULL REFERENCES placements (id) ON DELETE RESTRICT,
    stock_count                    BIGINT      NOT NULL CHECK (stock_count > 0),
    -- The reporter's note — what the approver decides on (FoundRequestCreateRequest.note, ≤ 200).
    note                           TEXT        NOT NULL DEFAULT '',
    -- A person, always: the approver must be somebody else (nobody-finalizes-their-own-count, by the same rule).
    reported_by_id                 BIGINT      NOT NULL CHECK (reported_by_id > 0),
    reported_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status                         TEXT        NOT NULL DEFAULT 'waiting'
                                               CHECK (status IN ('waiting', 'approved', 'rejected', 'settled')),
    -- The approver, the rejecter, or whoever finalized the count that settled it.
    decided_by_id                  BIGINT CHECK (decided_by_id > 0),
    decided_at                     TIMESTAMPTZ,
    reject_reason                  TEXT        NOT NULL DEFAULT '',
    -- APPROVED: the `found` transaction, and the batch it minted when anything was left after the claims.
    transaction_id                 BIGINT REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    minted_batch_id                BIGINT REFERENCES batches (id) ON DELETE RESTRICT,
    -- SETTLED: the count whose finalize closed it (a-count-settles-the-found-it-counted).
    settled_by_counting_session_id BIGINT REFERENCES opname_sessions (id) ON DELETE RESTRICT,

    -- Decided ⇔ not waiting, and a decision names who and when.
    CONSTRAINT found_requests_decided CHECK (
        (status = 'waiting') = (decided_by_id IS NULL) AND (decided_by_id IS NULL) = (decided_at IS NULL)),
    -- Approved ⇔ a transaction; only an approval mints.
    CONSTRAINT found_requests_approved_posts CHECK (
        (status = 'approved') = (transaction_id IS NOT NULL) AND (minted_batch_id IS NULL OR status = 'approved')),
    -- A rejection says why (the reporter reads it).
    CONSTRAINT found_requests_rejected_says_why CHECK (status <> 'rejected' OR reject_reason <> ''),
    -- Settled ⇔ the count that settled it.
    CONSTRAINT found_requests_settled_names_the_count CHECK (
        (status = 'settled') = (settled_by_counting_session_id IS NOT NULL))
);

-- The list, newest first: every status, and one status (FoundRequestListFilter.status).
CREATE INDEX found_requests_list_idx ON found_requests (warehouse_id, id DESC);
CREATE INDEX found_requests_status_idx ON found_requests (warehouse_id, status, id DESC);
-- The waiting requests of a product on a rack — what a count's finalize settles.
CREATE INDEX found_requests_waiting_idx ON found_requests (product_id, placement_id) WHERE status = 'waiting';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE found_requests;
-- +goose StatementEnd
