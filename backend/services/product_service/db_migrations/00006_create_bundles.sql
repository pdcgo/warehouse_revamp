-- +goose Up
-- +goose StatementBegin

-- A BUNDLE is a selling team's PICKING RECIPE — which products, and how many of each go into ONE bundle
-- (docs/business/product/product_bundle.md). It never sits on a shelf: no stock, no batch, no price. The order form
-- expands it into ordinary product lines, and an order keeps no link back (the-order-keeps-only-product-lines) — which
-- is why a bundle is HARD-deleted and nothing outside this service refers to one.
CREATE TABLE bundles (
    id                 BIGSERIAL   PRIMARY KEY,

    -- The owning SELLING team. Opaque cross-service id — no FK to team_service; scope is the access interceptor's.
    team_id            BIGINT      NOT NULL,

    -- MAY REPEAT within a team (bundle-names-may-repeat): the lines tell two bundles apart. So no unique index.
    name               TEXT        NOT NULL,
    description        TEXT        NOT NULL DEFAULT '',

    -- Who made it — set from the token, never changed. The one CS who may change it besides an Admin
    -- (the-creator-or-an-admin-edits-a-bundle). user_service's id: no FK.
    created_by_user_id BIGINT      NOT NULL,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT bundles_name_present CHECK (name <> '')
);

-- BundleList's one question: this team's bundles, the last change first.
CREATE INDEX bundles_team_updated_idx ON bundles (team_id, updated_at DESC, id DESC);

-- One product of a bundle, and how many of it go into ONE bundle (a-bundle-line-carries-its-quantity). Whose product it
-- is comes from products.team_id — no copy here (a-bundle-line-reads-its-owner-from-the-product).
CREATE TABLE bundle_products (
    id         BIGSERIAL PRIMARY KEY,

    -- A bundle is hard-deleted, and its lines go with it.
    bundle_id  BIGINT    NOT NULL REFERENCES bundles (id) ON DELETE CASCADE,

    -- Same service, so a real FK. A product is only ever ARCHIVED (products.deleted), never removed, so the FK never
    -- blocks anything — and an archived product's line keeps naming it.
    product_id BIGINT    NOT NULL REFERENCES products (id),

    -- At least 1; the ceiling is a typing rail, not a business rule.
    quantity   INT       NOT NULL,

    CONSTRAINT bundle_products_quantity_range CHECK (quantity BETWEEN 1 AND 9999),
    -- Each product once per bundle — the quantity is the only place the count lives.
    CONSTRAINT bundle_products_bundle_product_unique UNIQUE (bundle_id, product_id)
);

-- "Which bundles hold this product?" — the search's join, and anything that later asks it of an archived product.
CREATE INDEX bundle_products_product_idx ON bundle_products (product_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE bundle_products;
DROP TABLE bundles;
-- +goose StatementEnd
