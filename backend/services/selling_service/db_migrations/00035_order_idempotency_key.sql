-- +goose Up
-- THE ORDER KEEPS THE KEY IT WAS CREATED WITH (the-order-stores-its-idempotency-key) — minted by the form inside every
-- submit (the-frontend-mints-the-idempotency-key, every-submit-mints-a-new-key), and UNIQUE
-- (the-idempotency-key-is-unique): OrderCreate looks the key up first and refuses a used one
-- (the-order-refuses-a-used-key), and this index is the backstop for two submits of one key in the same second.
--
-- REQUIRED from the start (revamp-has-no-real-orders-yet). The rows already in a developer's database are filled with
-- `order:<id>` ONLY so the NOT NULL and the UNIQUE apply cleanly — no code keeps a path for them, and OrderCreate
-- refuses a new key starting `order:`, so a new order never meets a filled row.
ALTER TABLE orders ADD COLUMN idempotency_key TEXT;

UPDATE orders SET idempotency_key = 'order:' || id;

ALTER TABLE orders ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX orders_idempotency_key_idx ON orders (idempotency_key);

-- +goose Down
DROP INDEX orders_idempotency_key_idx;
ALTER TABLE orders DROP COLUMN idempotency_key;
