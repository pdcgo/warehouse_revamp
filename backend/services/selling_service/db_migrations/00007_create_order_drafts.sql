-- +goose Up
-- +goose StatementBegin
-- A DRAFT ORDER (#190, plans/selling_service/brainstorming.md §6) — an incomplete order pushed in by
-- a third-party app, which a person in this system finishes and promotes.
--
-- Its OWN table, deliberately NOT an ORDER_STATUS_DRAFT on `orders` (§6.2). The reason is not
-- tidiness: on one table every reader of `orders` becomes responsible for remembering to exclude
-- drafts — the order list, the pick queue, the revenue chain, every count — and one forgotten
-- `AND status <> 'draft'` puts an unfinished scrape into somebody's revenue report. Keeping them
-- apart lets `orders` keep every NOT NULL it has (a real order always has a warehouse, a shop, a
-- customer), while this table carries almost none, because incompleteness is what a draft IS.
CREATE TABLE order_drafts (
    id               BIGSERIAL   PRIMARY KEY,

    -- The scope. Carries (use_scope) on every draft request; the handler additionally narrows to
    -- author_user_id, because a draft is PERSONAL working state (§6.3). "Personal" is a handler
    -- filter, NOT a substitute for the scope — dropping team_id would leave a team-level role policy
    -- evaluated against the root team, which authorizes nobody.
    team_id          BIGINT      NOT NULL,
    -- Whoever's login the pushing app runs under. There is no machine identity in this system, and
    -- this feature deliberately does not invent one — so every draft has a human accountable on it.
    author_user_id   BIGINT      NOT NULL,

    -- The external reference, and the ONLY thing a draft is required to have (§6.10.3). Together with
    -- team_id it is UNIQUE, which is what makes OrderDraftPush idempotent: a re-push updates the draft
    -- in place instead of adding a near-identical one. An external caller on a flaky network WILL
    -- retry, so this is what stands between the list and a pile of duplicates nobody can tell apart.
    source           TEXT        NOT NULL,
    external_id      TEXT        NOT NULL,

    -- The field names a human has edited, as a JSON array of strings. OrderDraftPush reads it and
    -- writes only what is NOT listed here, so a background re-scrape can never silently destroy ten
    -- minutes of somebody's mapping work (§6.5). OrderDraftUpdate always wins, and adds to this list.
    touched_fields   JSONB       NOT NULL DEFAULT '[]',

    -- Everything below is optional — 0 or '' meaning "not known yet", which is the normal state of a
    -- draft rather than an error. Promote is where these become required, by running the same
    -- validation OrderCreate runs.
    shop_id          BIGINT      NOT NULL DEFAULT 0,
    warehouse_id     BIGINT      NOT NULL DEFAULT 0,

    customer_name    TEXT        NOT NULL DEFAULT '',
    customer_phone   TEXT        NOT NULL DEFAULT '',

    -- The same frozen-address shape `orders` carries (#118), so promote is a copy rather than a
    -- translation. Opaque region_service codes; no FK.
    provinsi_code    TEXT        NOT NULL DEFAULT '',
    provinsi_name    TEXT        NOT NULL DEFAULT '',
    kabupaten_code   TEXT        NOT NULL DEFAULT '',
    kabupaten_name   TEXT        NOT NULL DEFAULT '',
    kecamatan_code   TEXT        NOT NULL DEFAULT '',
    kecamatan_name   TEXT        NOT NULL DEFAULT '',
    desa_code        TEXT        NOT NULL DEFAULT '',
    desa_name        TEXT        NOT NULL DEFAULT '',
    kode_pos         TEXT        NOT NULL DEFAULT '',
    address_line     TEXT        NOT NULL DEFAULT '',
    shipping_code    TEXT        NOT NULL DEFAULT '',

    -- Money as scraped, whole rupiah. NOT the frozen money of an order: nothing here is authoritative
    -- until promote recomputes it, and cogs has no meaning at all yet — a draft's lines are mostly
    -- unmapped, so there is no product whose cost could be looked up.
    shipping_cost    BIGINT      NOT NULL DEFAULT 0,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- The external ref is the one thing required by construction; an empty one would also make the
    -- unique index below collide across unrelated drafts, which is a duplicate-merging bug rather
    -- than a validation complaint.
    CONSTRAINT order_drafts_external_ref_present CHECK (source <> '' AND external_id <> '')
);

-- What makes the push idempotent (§6.5). Per TEAM, not per author: the same marketplace order must
-- not become two drafts because two people's logins pushed it.
CREATE UNIQUE INDEX order_drafts_external_ref_idx
    ON order_drafts (team_id, source, external_id);

-- The list is the author's own drafts within a team, newest first (§6.7).
CREATE INDEX order_drafts_team_author_idx ON order_drafts (team_id, author_user_id, id DESC);

CREATE TABLE order_draft_items (
    id            BIGSERIAL   PRIMARY KEY,
    draft_id      BIGINT      NOT NULL REFERENCES order_drafts (id) ON DELETE CASCADE,

    -- What the app actually scraped: a marketplace's own sku and product TITLE. NEVER overwritten,
    -- not even by a person editing the line — it is the evidence of what the buyer ordered, and it is
    -- what lets somebody tell a wrong mapping from a right one (§6.4).
    external_sku  TEXT        NOT NULL DEFAULT '',
    external_name TEXT        NOT NULL DEFAULT '',

    -- Our catalogue id, 0 until a person maps the line. An unmapped line IS the incompleteness that
    -- makes this a draft, so 0 is the expected starting state and promote is what refuses it.
    product_id    BIGINT      NOT NULL DEFAULT 0,

    quantity      INT         NOT NULL DEFAULT 0,
    unit_price    BIGINT      NOT NULL DEFAULT 0,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No `quantity >= 1` CHECK, unlike order_items. A scrape can arrive with a quantity it could not
-- read, and refusing the whole push over one unreadable line would lose the other nine — the point
-- of a draft is to hold what is known and let a person finish it. Promote enforces it.
CREATE INDEX order_draft_items_draft_idx ON order_draft_items (draft_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE order_draft_items;
DROP TABLE order_drafts;
-- +goose StatementEnd
