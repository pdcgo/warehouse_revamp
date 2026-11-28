-- +goose Up
-- +goose StatementBegin

-- THE TEAM CODE CHANGE'S TRAIL ON EACH PRODUCT (backlog #149, #141 P2a — docs/business/product/context_decision.md:
-- a-team-code-change-recomposes-its-product-codes and its 🔄 lines, products-have-their-own-tag-list and its 🔄 *what
-- clears*; the design the-team-code-and-product-tags-prototype-is-accepted). When a selling team's code changes ABC → XYZ
-- (team_service's TeamCodeUpdate), its products take the new code in the SAME transaction — ABC-SHOE-42 → XYZ-SHOE-42,
-- archived ones too — and:
--
--   product_logs           each product's HISTORY, one line per change: `code_changed`, the code it carried and the code
--                          it took (whole, as stored), who changed the team code (an opaque user_service id; whether they
--                          were Root / the Administrator outside the team), when. Append-only. The product page's Riwayat
--                          Produk card reads it newest first (ProductLogList), and `old_code` is the product's FORMER code,
--                          which still finds it (the decision's Q1 "A", the scan in #152). The kind leaves room for later
--                          lines; deleting a product (one with no history) takes its lines with it.
--   product_reprint_waits  one row per (product, warehouse) where that warehouse held units of the product on a shelf at the
--                          change: its printed stickers no longer match the code, so it must reprint them. While a product
--                          has a row here it carries `need_reprint_code` (00010's app tag); the warehouse's reprint (#151)
--                          deletes its row, and the tag comes off with the last one. A product with nothing on a shelf
--                          anywhere gets no row and no tag. A second change before the reprint re-sets the rows to the
--                          warehouses holding stock then.
CREATE TABLE product_logs (
    id          BIGSERIAL   PRIMARY KEY,
    product_id  BIGINT      NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    kind        TEXT        NOT NULL CHECK (kind IN ('code_changed')),
    old_code    TEXT        NOT NULL CHECK (old_code <> ''),
    new_code    TEXT        NOT NULL CHECK (new_code <> ''),
    actor_id    BIGINT      NOT NULL DEFAULT 0 CHECK (actor_id >= 0),
    is_override BOOLEAN     NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A product's history, newest first, paged.
CREATE INDEX product_logs_product_idx ON product_logs (product_id, id DESC);

CREATE TABLE product_reprint_waits (
    product_id   BIGINT      NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    -- The warehouse team (an opaque team_service id) whose shelves hold the product's old stickers.
    warehouse_id BIGINT      NOT NULL CHECK (warehouse_id > 0),
    since        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (product_id, warehouse_id)
);

-- One warehouse's waiting products — its reprint's list and the *Cetak ulang kode (N)* count (#151).
CREATE INDEX product_reprint_waits_warehouse_idx ON product_reprint_waits (warehouse_id, product_id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE product_reprint_waits;
DROP TABLE product_logs;
-- +goose StatementEnd
