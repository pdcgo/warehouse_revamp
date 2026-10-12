-- +goose Up
-- +goose StatementBegin
-- THE SETTLEMENT IMPORTER's own record (docs/business/settlement/settlement_importer.md) — one row per
-- uploaded statement, and one per line it read. The ledger rows the lines post are settlement's; these
-- tables say what an upload DID, so the import screen can list files and one file's page can show what
-- did not simply post.

-- One uploaded statement.
--
-- ⚠ NOTHING HERE IS UNIQUE BUT THE ID (the-row-key-is-the-only-dedupe). The same file twice is two rows,
-- the second reading "already there" line by line — the row keys dedupe, never the file.
CREATE TABLE uploaded_files (
    id                  BIGSERIAL   PRIMARY KEY,
    -- The scope, and the shop the person picked. Opaque selling_service ids, no FK across services.
    team_id             BIGINT      NOT NULL,
    shop_id             BIGINT      NOT NULL,
    -- Which reader read it — 'shopee' or 'tiktok', san_marketplace's text. The shop's marketplace picks it.
    platform            TEXT        NOT NULL,
    -- document_service's id for the stored bytes — "download the original". Opaque, no FK.
    document_id         TEXT        NOT NULL,
    -- sha256 of the bytes, hex — the stored file's name (the-file-is-named-by-its-content-hash). NOT
    -- unique, and nothing looks it up.
    content_sha256      TEXT        NOT NULL,
    -- The statement's own range, as it states it. NULL until the file has been read.
    period_from         DATE,
    period_to           DATE,
    -- running · done · failed. INTERRUPTED is never stored: a running row whose updated_at has not
    -- moved for two minutes reads interrupted (an-import-finishes-whether-anyone-watches).
    status              TEXT        NOT NULL DEFAULT 'running',
    -- Why a FAILED file failed — its ERROR line. '' otherwise.
    failure             TEXT        NOT NULL DEFAULT '',
    -- The tallies. Every row the file yields is one of posted, existing, held, skipped; posted_to_shop
    -- is the part of posted whose ref found no order (an-unmatched-ref-posts-to-the-shop).
    rows_total          INT         NOT NULL DEFAULT 0,
    rows_posted         INT         NOT NULL DEFAULT 0,
    rows_existing       INT         NOT NULL DEFAULT 0,
    rows_held           INT         NOT NULL DEFAULT 0,
    rows_skipped        INT         NOT NULL DEFAULT 0,
    rows_posted_to_shop INT         NOT NULL DEFAULT 0,
    -- The uploader — the actor on every row this file posts. From the token, never the request.
    created_by_user_id  BIGINT      NOT NULL,
    -- The shop's primary CS when the file was checked — who its shop rows count for, as the check saw it.
    -- Settlement asks the shop again for each row (settlement-asks-the-shop-for-its-primary-cs).
    primary_user_id     BIGINT      NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- MOVES WITH THE TALLIES, after every line — so a server stopped mid-file leaves it still, and the
    -- row reads interrupted.
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at         TIMESTAMPTZ
);

-- The import screen — a team's uploads, newest first, optionally one shop's.
CREATE INDEX uploaded_files_team_created_idx ON uploaded_files (team_id, created_at DESC, id DESC);
CREATE INDEX uploaded_files_team_shop_created_idx ON uploaded_files (team_id, shop_id, created_at DESC, id DESC);

-- One line the file yielded, and what became of it. A commissioned TikTok order yields TWO — its fund and
-- its affiliate_fee (tiktok-affiliate-commission-posts-as-affiliate-fee).
CREATE TABLE uploaded_file_lines (
    id                BIGSERIAL   PRIMARY KEY,
    uploaded_file_id  BIGINT      NOT NULL REFERENCES uploaded_files (id) ON DELETE CASCADE,
    -- Its place in the order the file was read — the stream's step.
    line_no           INT         NOT NULL,
    -- "Rincian Transaksi", "Order details", "Withdrawal records".
    sheet             TEXT        NOT NULL,
    -- The ledger key it posted under, or would have — <platform>:<sheet>:<GenerateUniqueID>.
    unique_id         TEXT        NOT NULL,
    -- As the file wrote them.
    order_ref         TEXT        NOT NULL DEFAULT '',
    platform_type     TEXT        NOT NULL DEFAULT '',
    description       TEXT        NOT NULL DEFAULT '',
    -- settlement's text for what it became — '' when the platform's type is not mapped.
    settlement_type   TEXT        NOT NULL DEFAULT '',
    -- Whole rupiah. A fractional line keeps its figure as written in `detail`.
    change            BIGINT      NOT NULL DEFAULT 0,
    occurred_on       DATE,
    -- The order it posted to — 0 for the shop.
    order_id          BIGINT      NOT NULL DEFAULT 0,
    -- posted · existing · held · skipped.
    outcome           TEXT        NOT NULL,
    -- no_order · unmapped_type · fractional_amount · refused · repeats_order_details · failed_withdrawal.
    reason            TEXT        NOT NULL DEFAULT '',
    detail            TEXT        NOT NULL DEFAULT '',
    -- The ledger row it posted or found. 0 when held or skipped.
    settlement_log_id BIGINT      NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One file's page — its lines by outcome, in the file's order.
CREATE INDEX uploaded_file_lines_file_outcome_idx ON uploaded_file_lines (uploaded_file_id, outcome, line_no);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE uploaded_file_lines;
DROP TABLE uploaded_files;
-- +goose StatementEnd
