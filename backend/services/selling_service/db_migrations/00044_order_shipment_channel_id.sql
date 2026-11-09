-- +goose Up
-- +goose StatementBegin
-- THE COURIER IS AN ID INTO SHIPMENT (shipment-channel-is-an-id-into-shipment-service, the-channel-name-is-not-frozen):
-- `shipment_channel_id` replaces the courier CODE the bridge stored (the-old-catalogue-bridges-by-code — "moving those
-- records to shipment_channel_id belongs to the order redesign"). An OPAQUE id owned by shipment_service — no FK, no code,
-- no name beside it; every screen resolves the name at read time.
--
-- 0 = no courier. An order may not be CREATED with 0 (no-order-without-a-courier — placeOrder refuses it on both
-- doors); a draft may hold 0 while the app could not convert the platform's courier
-- (the-app-converts-the-courier-to-a-channel-id).
--
-- NO code-to-id fill. The codes name rows of shipment_service's `shipment_channels`, which a selling migration may not
-- read (HARD RULE 3), and revamp holds no real orders (revamp-has-no-real-orders-yet): a developer's older rows simply
-- show no courier. No CHECK on orders for the same reason — those rows hold 0.
ALTER TABLE orders
    ADD COLUMN shipment_channel_id BIGINT NOT NULL DEFAULT 0;

ALTER TABLE order_drafts
    ADD COLUMN shipment_channel_id BIGINT NOT NULL DEFAULT 0;

ALTER TABLE orders
    DROP COLUMN shipping_code;

ALTER TABLE order_drafts
    DROP COLUMN shipping_code;

-- The draft's touched-field marks name the field, so a courier a person picked stays protected from the app's next push
-- under its new name.
UPDATE order_drafts
SET touched_fields = (
    SELECT COALESCE(
        jsonb_agg(CASE WHEN name = 'shipping_code' THEN 'shipment_channel_id' ELSE name END),
        '[]'::jsonb
    )
    FROM jsonb_array_elements_text(touched_fields) AS name
)
WHERE touched_fields @> '["shipping_code"]'::jsonb;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
UPDATE order_drafts
SET touched_fields = (
    SELECT COALESCE(
        jsonb_agg(CASE WHEN name = 'shipment_channel_id' THEN 'shipping_code' ELSE name END),
        '[]'::jsonb
    )
    FROM jsonb_array_elements_text(touched_fields) AS name
)
WHERE touched_fields @> '["shipment_channel_id"]'::jsonb;

ALTER TABLE order_drafts
    ADD COLUMN shipping_code TEXT NOT NULL DEFAULT '';

ALTER TABLE orders
    ADD COLUMN shipping_code TEXT NOT NULL DEFAULT '';

ALTER TABLE order_drafts
    DROP COLUMN shipment_channel_id;

ALTER TABLE orders
    DROP COLUMN shipment_channel_id;
-- +goose StatementEnd
