-- +goose Up
-- +goose StatementBegin

-- The couriers live orders ship by, beyond the first three — docs/business/shipment/context_decision.md
-- (the-channels-are-what-orders-ship-by). Seen on real labels; reference data every database needs, production too,
-- so no-order-without-a-courier never refuses an order a seller ships today.
--
-- ON CONFLICT: a code root already created from the channels page — deleted or not — is root's row and stays as it is
-- (a-deleted-code-is-restored-not-recreated). An aggregator (KiriminAja) is never a row: the order points at the
-- courier it booked.
INSERT INTO shipment_channels (code, name) VALUES
    ('spx',         'SPX Express'),
    ('grabexpress', 'GrabExpress'),
    ('jntcargo',    'J&T Cargo'),
    ('idexpress',   'ID Express'),
    ('lex',         'LEX'),
    ('anteraja',    'AnterAja'),
    ('gosend',      'GoSend'),
    ('pos',         'Pos Indonesia')
ON CONFLICT (code) DO NOTHING;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- Nothing is removed. A channel is never removed (a-channel-is-soft-deleted): an order may already point at one of
-- these, and a row root edited since is no longer the seed's to take back. Re-running Up is harmless.
SELECT 1;

-- +goose StatementEnd
