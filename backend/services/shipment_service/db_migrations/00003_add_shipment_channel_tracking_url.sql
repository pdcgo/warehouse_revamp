-- +goose Up
-- +goose StatementBegin

-- Each courier's own tracking page — docs/business/shipment/context_decision.md
-- (an-orders-resi-links-to-the-couriers-tracking-page, the-tracking-link-prototype-is-accepted). Root keeps one link per
-- channel (a-channel-is-a-courier, only-root-manages-channels) with `{resi}` where the number goes; the screens fill it
-- with the order's resi. '' = none: that courier's orders keep a copy-only resi.
--
-- No backfill: every courier starts with no link — root types each real address on the channels page.
--
-- The CHECK is the table's last word on the two rules a link can break in SQL terms (the handler also refuses a link
-- that is no address, and says which rule each refusal broke): https only, and `{resi}` in it
-- (a-tracking-link-must-carry-the-resi). Every existing row is '' and passes.
ALTER TABLE shipment_channels
    ADD COLUMN tracking_url TEXT NOT NULL DEFAULT '';

ALTER TABLE shipment_channels
    ADD CONSTRAINT shipment_channels_tracking_url_shape CHECK (
        tracking_url = ''
        OR (lower(tracking_url) LIKE 'https://%' AND strpos(tracking_url, '{resi}') > 0)
    );

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE shipment_channels
    DROP CONSTRAINT shipment_channels_tracking_url_shape;

ALTER TABLE shipment_channels
    DROP COLUMN tracking_url;
-- +goose StatementEnd
