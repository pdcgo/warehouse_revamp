-- +goose Up
-- +goose StatementBegin
ALTER TABLE products
    -- The product's category (a node in category_service's taxonomy). Opaque cross-service id, no
    -- FK — required on write (the handler rejects 0), DEFAULT 0 only so pre-existing rows survive.
    ADD COLUMN category_id                  BIGINT NOT NULL DEFAULT 0,
    -- The denormalised cover image, mirrored from the first product_images row so a list/card never
    -- has to join. Empty when the product has no images.
    ADD COLUMN default_image_url            TEXT   NOT NULL DEFAULT '',
    ADD COLUMN default_image_thumbnail_url  TEXT   NOT NULL DEFAULT '';

CREATE INDEX products_category_idx ON products (category_id) WHERE deleted = FALSE;

-- The gallery. A product has up to 5 images (enforced by the handler + proto, not the DB); ordered
-- by `position` (0 = cover). ON DELETE CASCADE covers a hard delete — products are normally
-- soft-deleted, so in practice the images stay with the soft-deleted product.
CREATE TABLE product_images (
    id            BIGSERIAL   PRIMARY KEY,
    product_id    BIGINT      NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    url           TEXT        NOT NULL,
    thumbnail_url TEXT        NOT NULL DEFAULT '',
    position      INT         NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT product_images_url_present CHECK (url <> '')
);

CREATE INDEX product_images_product_idx ON product_images (product_id, position);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE product_images;

DROP INDEX products_category_idx;

ALTER TABLE products
    DROP COLUMN category_id,
    DROP COLUMN default_image_url,
    DROP COLUMN default_image_thumbnail_url;
-- +goose StatementEnd
