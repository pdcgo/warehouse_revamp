-- +goose Up
-- +goose StatementBegin
-- WHAT THE BUYER PAID is `platform_total` — in every doc, proto, column and screen
-- (the-total-is-ours-the-platform-total-is-theirs, platform-is-the-word-for-the-outside-marketplace). A RENAME, not a
-- new figure: the column added by 00008 (orders) and 00022 (order_drafts) keeps every value it held, and stays a FACT
-- read off the storefront, required at finalize (platform-total-is-required-at-finalize). 0 still means "not recorded"
-- on an order placed before 00022, and "not known yet" on a draft.
--
-- Both tables at once, so the vocabulary is never half-renamed.
ALTER TABLE orders
    RENAME COLUMN marketplace_total TO platform_total;

ALTER TABLE order_drafts
    RENAME COLUMN marketplace_total TO platform_total;

-- The draft's touched-field marks name the field, so a person's typed figure stays protected from the app's next push
-- under its new name.
UPDATE order_drafts
SET touched_fields = (
    SELECT COALESCE(
        jsonb_agg(CASE WHEN name = 'marketplace_total' THEN 'platform_total' ELSE name END),
        '[]'::jsonb
    )
    FROM jsonb_array_elements_text(touched_fields) AS name
)
WHERE touched_fields @> '["marketplace_total"]'::jsonb;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
UPDATE order_drafts
SET touched_fields = (
    SELECT COALESCE(
        jsonb_agg(CASE WHEN name = 'platform_total' THEN 'marketplace_total' ELSE name END),
        '[]'::jsonb
    )
    FROM jsonb_array_elements_text(touched_fields) AS name
)
WHERE touched_fields @> '["platform_total"]'::jsonb;

ALTER TABLE order_drafts
    RENAME COLUMN platform_total TO marketplace_total;

ALTER TABLE orders
    RENAME COLUMN platform_total TO marketplace_total;
-- +goose StatementEnd
