-- +goose Up
-- +goose StatementBegin
-- A DRAFT STORES NO MAPPING (a-draft-stores-no-mapping): a draft's lines are the platform's reference — title, price,
-- quantity — and the CS maps each one to a product, a bundle or a split in the order form, straight into `order_items`
-- at Create. The stored `product_id` (0 until a person mapped it on the old draft page, which is gone) goes; a mapping
-- half done and abandoned is lost, as the decision accepts. Revamp has no real drafts (revamp-has-no-real-orders-yet).
ALTER TABLE order_draft_items
    DROP COLUMN product_id;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- The mapping is not recoverable: every line comes back unmapped (0), which is what an unmapped line always held.
ALTER TABLE order_draft_items
    ADD COLUMN product_id BIGINT NOT NULL DEFAULT 0;
-- +goose StatementEnd
