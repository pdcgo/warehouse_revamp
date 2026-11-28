-- +goose Up
-- +goose StatementBegin

-- PRODUCT TAGS (backlog #147, #141 P1a — docs/business/product/context_decision.md: products-have-their-own-tag-list and
-- its 🔄 lines; the design the-team-code-and-product-tags-prototype-is-accepted). A product carries TAGS, and both
-- Products lists filter by them. A copy of the order tags (selling 00055) with the restock tags' app task (inventory 00055).
--
--   product_tags       THE PRODUCTS' OWN LIST — apart from the orders' (selling's `order_tags`) and the restocks'
--                      (inventory's `tags`): one list for every team, a name unique within it, compared case-insensitively
--                      (the unique index on lower(name)); kept trimmed with its inner white space folded to one space (the
--                      CHECK), so "  promo   lebaran" and "Promo Lebaran" are one tag. `type` is 'system' (made, put on and
--                      taken off only by Root / the Administrator and the app's own tasks) or 'custom' (made, put on and
--                      taken off by anyone who may write on the product). `app_task` names the app's own task that owns a
--                      SYSTEM tag; '' otherwise — unique where set, and only on a system tag. A tag with one is LOCKED for
--                      everyone, admins included: never put on, taken off, renamed or deleted by hand.
--   product_tag_links  one tag on one product — the pair is the key, so a tag is on a product once — with who put it on
--                      (an opaque user_service id; 0 = the app) and when. Deleting a tag takes it off every product, and
--                      deleting a product (one with no history) takes its tags with it (ON DELETE CASCADE both ways; the
--                      tag delete locks the tag row first).
CREATE TABLE product_tags (
    id                     BIGSERIAL   PRIMARY KEY,
    name                   TEXT        NOT NULL CHECK (
        name <> '' AND char_length(name) <= 60 AND name = btrim(regexp_replace(name, '\s+', ' ', 'g'))
    ),
    type                   TEXT        NOT NULL CHECK (type IN ('system', 'custom')),
    app_task               TEXT        NOT NULL DEFAULT '' CHECK (app_task = '' OR type = 'system'),
    created_by_user_id     BIGINT      NOT NULL DEFAULT 0 CHECK (created_by_user_id >= 0),
    created_by_is_override BOOLEAN     NOT NULL DEFAULT false,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ONE NAME, ONE TAG: the create's ON CONFLICT and the rename's refusal both stand on this index.
CREATE UNIQUE INDEX product_tags_name_key ON product_tags (lower(name));

-- The app's own tags are found by their task, never by their name.
CREATE UNIQUE INDEX product_tags_app_task_key ON product_tags (app_task) WHERE app_task <> '';

CREATE TABLE product_tag_links (
    product_id           BIGINT      NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    tag_id               BIGINT      NOT NULL REFERENCES product_tags (id) ON DELETE CASCADE,
    added_by_user_id     BIGINT      NOT NULL DEFAULT 0 CHECK (added_by_user_id >= 0),
    added_by_is_override BOOLEAN     NOT NULL DEFAULT false,
    added_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (product_id, tag_id)
);

-- The other side of the key: the lists' tag filter from a rare tag (a semi-join driven from the tag), the admins' per-tag
-- count, and the delete's take-off.
CREATE INDEX product_tag_links_tag_idx ON product_tag_links (tag_id, product_id);

-- THE APP'S FIRST PRODUCT TAG (products-have-their-own-tag-list; its name as the owner wrote it,
-- the-team-code-and-product-tags-prototype-is-accepted: "the tag shown as `need_reprint_code`") — put on by the team code
-- change (a-team-code-change-recomposes-its-product-codes, backlog #149) and taken off by the app once every warehouse
-- holding the product's stock has printed its new labels (its 🔄 *what clears*, backlog #151). Locked for everyone,
-- admins included. Seeded here so the list, the filter and the lock exist before the task that uses it.
INSERT INTO product_tags (name, type, app_task) VALUES
    ('need_reprint_code', 'system', 'product.code.reprint');

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE product_tag_links;
DROP TABLE product_tags;

-- +goose StatementEnd
