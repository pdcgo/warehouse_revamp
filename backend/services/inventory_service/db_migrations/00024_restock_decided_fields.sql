-- +goose Up
-- +goose StatementBegin
-- THE DECIDED RESTOCK, on today's table names (restocks-non-stock-parts-come-before-the-switch-over). Every field the
-- contract carries and the mapper has been dropping gets a column, and the stopgaps the mapper kept are rewritten as
-- data. The tables take the owner's names (restocks, restock_items, restock_problem_items) in the commit that moves the
-- accept onto the ledgers, which rewrites the stock readers that join them anyway. Nothing is in production, so nothing
-- here has to survive a later reshape either (no-switch-over-the-ledgers-replace-todays-tables).

-- 1. THE STATUS WORDS THE CONTRACT USES (the-restock-contract-changes-in-place). `pending` always meant ONGOING and
--    `fulfilled` ACCEPTED. `arrived` and `lost` are new, so no row holds them yet.
UPDATE restock_requests SET status = 'ongoing'  WHERE status = 'pending';
UPDATE restock_requests SET status = 'accepted' WHERE status = 'fulfilled';
ALTER TABLE restock_requests ALTER COLUMN status SET DEFAULT 'ongoing';

-- 2. A UNIT SHORT IN THE BOX IS MISSING (a-short-unit-at-the-door-is-missing). `lost` keeps its two other meanings: a
--    parcel that never came, a unit gone from a rack.
UPDATE restock_damaged_units SET damage_type = 'missing' WHERE damage_type = 'lost';

--    Its note is optional (a-broken-reason-is-optional), so 00013's non-empty CHECK goes, and the words the stopgap wrote
--    to satisfy it are not a note anybody typed.
ALTER TABLE restock_damaged_units DROP CONSTRAINT IF EXISTS restock_damaged_units_reason_check;
UPDATE restock_damaged_units SET reason = '' WHERE reason IN ('broken at the door', 'missing from the box');

-- 3. THE RESTOCK'S DECIDED FIELDS. Every id here is another service's, so none has a foreign key.
ALTER TABLE restock_requests
    -- A photo of the courier's label; `receipt` is the tracking number itself (the-receipt-is-the-tracking-number).
    ADD COLUMN receipt_file                   TEXT        NOT NULL DEFAULT '',
    -- The courier, a shipment_service channel. 0 = not named.
    ADD COLUMN shipment_id                    BIGINT      NOT NULL DEFAULT 0 CHECK (shipment_id >= 0),
    -- The selling team's account that paid (a-restock-names-its-paying-account). 0 = a restock raised before it was
    -- required; the contract requires it on every new one.
    ADD COLUMN finance_account_id             BIGINT      NOT NULL DEFAULT 0 CHECK (finance_account_id >= 0),
    -- The accept's inventory transaction (every-stock-change-belongs-to-a-transaction). 0 until the accept writes the
    -- ledgers (the-decided-ledgers-come-before-the-restock-accept).
    ADD COLUMN transaction_id                 BIGINT      NOT NULL DEFAULT 0 CHECK (transaction_id >= 0),
    -- The courier's charge at the door, ONE per restock (the-courier-is-paid-once-per-restock), outside `total`
    -- (the-couriers-charge-stays-out-of-total) and inside the unit price (the-couriers-ask-is-in-the-unit-price). Its
    -- note is required above 0 by the contract, never by a CHECK: the legacy line below may carry none.
    ADD COLUMN warehouse_additional_cost      BIGINT      NOT NULL DEFAULT 0 CHECK (warehouse_additional_cost >= 0),
    ADD COLUMN warehouse_additional_cost_note TEXT        NOT NULL DEFAULT '',
    -- Who signed for the box, and who gave up on it (the-warehouse-signs-and-accepts-the-team-does-the-rest). The list
    -- filters and date fields read these; restock_logs holds the order of events.
    ADD COLUMN arrived_by_user_id             BIGINT      NOT NULL DEFAULT 0 CHECK (arrived_by_user_id >= 0),
    ADD COLUMN arrived_at                     TIMESTAMPTZ,
    ADD COLUMN lost_by_user_id                BIGINT      NOT NULL DEFAULT 0 CHECK (lost_by_user_id >= 0),
    ADD COLUMN lost_at                        TIMESTAMPTZ;

-- 4. THE COST LINES FOLD INTO THE ONE CHARGE. A restock never carried more than one (00022), so the sum is that line;
--    notes are joined in case it did.
UPDATE restock_requests r
SET warehouse_additional_cost      = c.amount,
    warehouse_additional_cost_note = c.note
FROM (
    SELECT restock_request_id,
           SUM(amount)                                               AS amount,
           COALESCE(string_agg(NULLIF(note, ''), '; ' ORDER BY id), '') AS note
    FROM restock_cost_lines
    GROUP BY restock_request_id
) c
WHERE c.restock_request_id = r.id;

DROP TABLE restock_cost_lines;

-- 5. A LINE NAMES ITS SUPPLIER, ITS STORE AND A NOTE (a-line-names-the-channel-it-was-bought-from,
--    a-line-may-name-a-supplier-without-a-channel, three-notes-one-writer-each). supplier_service ids: no foreign key.
ALTER TABLE restock_request_items
    ADD COLUMN supplier_id         BIGINT CHECK (supplier_id > 0),
    ADD COLUMN supplier_channel_id BIGINT CHECK (supplier_channel_id > 0),
    ADD COLUMN note                TEXT   NOT NULL DEFAULT '';

--    The restock-level supplier was every line's, so each line inherits it, and the restock stops carrying one.
UPDATE restock_request_items i
SET supplier_id = r.supplier_id
FROM restock_requests r
WHERE r.id = i.restock_request_id
  AND r.supplier_id IS NOT NULL;

ALTER TABLE restock_requests DROP COLUMN supplier_id;

-- 6. A PRODUCT APPEARS ONCE PER RESTOCK (a-product-appears-once-per-restock), and the database says so. A restock that
--    already breaks it stops the migration with its id, rather than having a line silently merged or dropped.
DO $$
DECLARE
    dup TEXT;
BEGIN
    SELECT string_agg(DISTINCT restock_request_id::text, ', ')
    INTO dup
    FROM (
        SELECT restock_request_id
        FROM restock_request_items
        GROUP BY restock_request_id, product_id
        HAVING COUNT(*) > 1
    ) d;

    IF dup IS NOT NULL THEN
        RAISE EXCEPTION 'restock(s) % list a product twice — fix them before migrating', dup;
    END IF;
END $$;

CREATE UNIQUE INDEX restock_request_items_product_once
    ON restock_request_items (restock_request_id, product_id);

-- 7. A PROBLEM ROW CARRIES ITS PRICE, filled by the system at accept (the-problem-price-is-filled-by-the-system): the
--    LANDED unit price, the same as a good unit's (all-qty-is-every-unit-ordered) —
--    line total ÷ line count + (shipping + the courier's charge) ÷ every unit ordered in the restock.
ALTER TABLE restock_damaged_units
    ADD COLUMN price_unit BIGINT NOT NULL DEFAULT 0 CHECK (price_unit >= 0),
    ADD COLUMN total      BIGINT NOT NULL DEFAULT 0 CHECK (total >= 0);

UPDATE restock_damaged_units d
SET price_unit = p.landed,
    total      = p.landed * d.quantity
FROM (
    SELECT i.id AS item_id,
           i.total_price / i.quantity
             + (r.shipping_cost + r.warehouse_additional_cost) / q.all_qty AS landed
    FROM restock_request_items i
    JOIN restock_requests r ON r.id = i.restock_request_id
    JOIN (
        SELECT restock_request_id, SUM(quantity) AS all_qty
        FROM restock_request_items
        GROUP BY restock_request_id
    ) q ON q.restock_request_id = i.restock_request_id
) p
WHERE p.item_id = d.restock_request_item_id;

-- 8. THE TRAIL (every-status-change-is-logged, edits-are-in-the-same-trail): one row per status change AND per edit,
--    from and to, by whom, why. It replaces restock_request_events, whose `kind` named an act but not the statuses.
CREATE TABLE restock_logs (
    id                 BIGSERIAL   PRIMARY KEY,
    restock_request_id BIGINT      NOT NULL REFERENCES restock_requests (id) ON DELETE CASCADE,

    -- Status words as `restock_requests.status` stores them. '' as `from_status` is the create: nothing came before.
    -- An edit keeps the status, so its from and to are the same and `description` says what changed.
    from_status        TEXT        NOT NULL DEFAULT '',
    to_status          TEXT        NOT NULL,

    -- An opaque user_service id; 0 = not recorded (a backfilled row whose actor nobody captured).
    actor_user_id      BIGINT      NOT NULL DEFAULT 0 CHECK (actor_user_id >= 0),
    description        TEXT        NOT NULL DEFAULT '',

    -- WHEN it happened. Its own column, as in 00019: the backfill below writes history, and an insert time is not an
    -- event time.
    at                 TIMESTAMPTZ NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The one read: a restock's history, oldest first.
CREATE INDEX idx_restock_logs_restock ON restock_logs (restock_request_id, at, id);

INSERT INTO restock_logs (restock_request_id, from_status, to_status, actor_user_id, description, at, created_at)
SELECT e.restock_request_id,
       CASE e.kind WHEN 'created' THEN '' ELSE 'ongoing' END,
       CASE e.kind
           WHEN 'created'   THEN 'ongoing'
           WHEN 'edited'    THEN 'ongoing'
           WHEN 'accepted'  THEN 'accepted'
           WHEN 'cancelled' THEN 'cancelled'
           ELSE 'ongoing'
       END,
       e.actor_user_id,
       -- The event's own word, as a new row of the same kind says it (restockLog* in the mapper).
       e.kind,
       e.at,
       e.created_at
FROM restock_request_events e;

DROP TABLE restock_request_events;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- ⚠ NOT A ROUND TRIP. The trail goes back to events by its to-status, the charge back to one cost line, and every
-- line's supplier back onto its restock only where all its lines agreed. Nothing is in production, so a developer's
-- database is reseeded rather than trusted to this.
CREATE TABLE restock_request_events (
    id                 BIGSERIAL PRIMARY KEY,
    restock_request_id BIGINT      NOT NULL REFERENCES restock_requests (id) ON DELETE CASCADE,
    kind               TEXT        NOT NULL,
    actor_user_id      BIGINT      NOT NULL DEFAULT 0 CHECK (actor_user_id >= 0),
    at                 TIMESTAMPTZ NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_restock_request_events_request ON restock_request_events (restock_request_id, at, id);

INSERT INTO restock_request_events (restock_request_id, kind, actor_user_id, at, created_at)
SELECT restock_request_id,
       CASE
           WHEN from_status = '' THEN 'created'
           WHEN from_status = to_status THEN 'edited'
           ELSE to_status
       END,
       actor_user_id, at, created_at
FROM restock_logs;
DROP TABLE restock_logs;

ALTER TABLE restock_damaged_units DROP COLUMN price_unit, DROP COLUMN total;

DROP INDEX restock_request_items_product_once;

ALTER TABLE restock_requests ADD COLUMN supplier_id BIGINT;
UPDATE restock_requests r
SET supplier_id = s.supplier_id
FROM (
    SELECT restock_request_id, MIN(supplier_id) AS supplier_id
    FROM restock_request_items
    GROUP BY restock_request_id
    HAVING COUNT(DISTINCT supplier_id) = 1
) s
WHERE s.restock_request_id = r.id;

ALTER TABLE restock_request_items DROP COLUMN supplier_id, DROP COLUMN supplier_channel_id, DROP COLUMN note;

CREATE TABLE restock_cost_lines (
    id                 BIGSERIAL   PRIMARY KEY,
    restock_request_id BIGINT      NOT NULL REFERENCES restock_requests (id) ON DELETE CASCADE,
    kind               TEXT        NOT NULL,
    amount             BIGINT      NOT NULL CHECK (amount > 0),
    note               TEXT        NOT NULL DEFAULT '',
    actor_id           BIGINT      NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX restock_cost_lines_request_idx ON restock_cost_lines (restock_request_id, id);

INSERT INTO restock_cost_lines (restock_request_id, kind, amount, note, actor_id, created_at)
SELECT id, 'incidental', warehouse_additional_cost, warehouse_additional_cost_note, accepted_by_user_id,
       COALESCE(accepted_at, updated_at)
FROM restock_requests
WHERE warehouse_additional_cost > 0;

ALTER TABLE restock_requests
    DROP COLUMN receipt_file,
    DROP COLUMN shipment_id,
    DROP COLUMN finance_account_id,
    DROP COLUMN transaction_id,
    DROP COLUMN warehouse_additional_cost,
    DROP COLUMN warehouse_additional_cost_note,
    DROP COLUMN arrived_by_user_id,
    DROP COLUMN arrived_at,
    DROP COLUMN lost_by_user_id,
    DROP COLUMN lost_at;

UPDATE restock_damaged_units SET reason = 'broken at the door' WHERE reason = '' AND damage_type = 'broken';
UPDATE restock_damaged_units SET reason = 'missing from the box' WHERE reason = '' AND damage_type = 'missing';
ALTER TABLE restock_damaged_units ADD CONSTRAINT restock_damaged_units_reason_check CHECK (reason <> '');
UPDATE restock_damaged_units SET damage_type = 'lost' WHERE damage_type = 'missing';

-- `arrived` and `lost` have no word to go back to; they read as still on the way.
UPDATE restock_requests SET status = 'pending'   WHERE status IN ('ongoing', 'arrived', 'lost');
UPDATE restock_requests SET status = 'fulfilled' WHERE status = 'accepted';
ALTER TABLE restock_requests ALTER COLUMN status SET DEFAULT 'pending';
-- +goose StatementEnd
