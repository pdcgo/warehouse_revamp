-- +goose Up
-- +goose StatementBegin

-- ORDER TAGS (backlog #100 — docs/business/order/context_decision.md: orders-have-their-own-tag-list and its 🔄 lines; the
-- design the-order-tags-prototype-is-accepted in docs/technical/frontend/order_list_decision.md). An order carries TAGS,
-- and both order lists filter by them.
--
--   order_tags       THE ORDERS' OWN LIST — apart from the restocks' (inventory's `tags`): one list for every team, a name
--                    unique within it, compared case-insensitively (the unique index on lower(name)); kept trimmed with
--                    its inner white space folded to one space (the CHECK), so "  vip   gold" and "VIP Gold" are one tag.
--                    `type` is 'system' (made, put on and taken off only by Root / the Administrator) or 'custom' (made
--                    freely by anyone who may write on an order). No app task: the app owns no order tag for now (the
--                    🔄 "A" on app tags), so none is locked for an admin.
--   order_tag_links  one tag on one order — the pair is the key, so a tag is on an order once — with who put it on (an
--                    opaque user_service id) and when. Deleting a tag takes it off every order (ON DELETE CASCADE; the RPC
--                    locks the tag row first).
CREATE TABLE order_tags (
    id                     BIGSERIAL   PRIMARY KEY,
    name                   TEXT        NOT NULL CHECK (
        name <> '' AND char_length(name) <= 60 AND name = btrim(regexp_replace(name, '\s+', ' ', 'g'))
    ),
    type                   TEXT        NOT NULL CHECK (type IN ('system', 'custom')),
    created_by_user_id     BIGINT      NOT NULL DEFAULT 0 CHECK (created_by_user_id >= 0),
    created_by_is_override BOOLEAN     NOT NULL DEFAULT false,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ONE NAME, ONE TAG: the create's ON CONFLICT and the rename's refusal both stand on this index.
CREATE UNIQUE INDEX order_tags_name_key ON order_tags (lower(name));

CREATE TABLE order_tag_links (
    order_id             BIGINT      NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    tag_id               BIGINT      NOT NULL REFERENCES order_tags (id) ON DELETE CASCADE,
    added_by_user_id     BIGINT      NOT NULL DEFAULT 0 CHECK (added_by_user_id >= 0),
    added_by_is_override BOOLEAN     NOT NULL DEFAULT false,
    added_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (order_id, tag_id)
);

-- The other side of the key: the lists' tag filter from a rare tag (a semi-join driven from the tag), the admins' per-tag
-- count, and the delete's take-off.
CREATE INDEX order_tag_links_tag_idx ON order_tag_links (tag_id, order_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE order_tag_links;
DROP TABLE order_tags;

-- +goose StatementEnd
