-- +goose Up
-- +goose StatementBegin
-- WHAT THE WAREHOUSE LAID OUT TO RECEIVE A DELIVERY, one row per outlay.
--
-- This replaces `restock_requests.cod_shipping_fee`, a scalar that could only ever hold the one cost
-- it was named after. Paying the courier at the door is not the only money a warehouse spends getting
-- a delivery in, and every other kind had nowhere to go — so it was either not recorded at all, or
-- typed into the COD box and mislabelled.
--
-- ⚠ THE SAME RUPIAH ANSWERS TWO QUESTIONS, and a line is written once for both:
--   1. COSTING — it joins `shipping_cost` in the freight spread over the units that arrived sellable,
--      so it reaches the batch's frozen unit cost and then the order's COGS.
--   2. SETTLEMENT — it raises what the requesting team owes this warehouse, because the warehouse is
--      out of pocket for goods it does not own.
-- Recording it here must not remove it from either.
--
-- Money is BIGINT, whole rupiah, as everywhere else in this system.
CREATE TABLE restock_cost_lines (
    id                  BIGSERIAL   PRIMARY KEY,

    -- The delivery this was spent on. Same service, so a real FK — and ON DELETE CASCADE because a
    -- cost line has no meaning without the delivery it belongs to.
    restock_request_id  BIGINT      NOT NULL
        REFERENCES restock_requests (id) ON DELETE CASCADE,

    -- WHICH KIND, as TEXT with no CHECK IN-list — the proto enum and the mapper guard the value,
    -- exactly as `orders.status` is handled. An IN-list is one more place to drift when the enum
    -- grows, and this enum is expected to grow: it starts at two.
    kind                TEXT        NOT NULL,

    -- POSITIVE, always. A line of zero is not a cost — it is a claim that nothing happened, and it
    -- would post a debt of nothing to the requesting team. Negative would be a refund, which is a
    -- different event this does not model yet.
    amount              BIGINT      NOT NULL CHECK (amount > 0),

    -- WHY, in words. Required for `other` by the handler rather than here, because that constraint is
    -- about the PAIR of columns: an untyped amount with no words beside it is a number the team being
    -- charged cannot argue with.
    note                TEXT        NOT NULL DEFAULT '',

    -- WHO TYPED IT. An opaque user_service id, like every cross-service id here. A cost charged to
    -- another team with nobody's name on it is the first thing a dispute asks for.
    actor_id            BIGINT      NOT NULL DEFAULT 0,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The delivery's lines, in the order they were typed. Every read of this table is "the lines of this
-- restock" — the detail screen, the freight sum, and the liability posting all ask exactly that.
CREATE INDEX restock_cost_lines_request_idx
    ON restock_cost_lines (restock_request_id, id);

-- THE EXISTING COD FEES BECOME ORDINARY LINES. Nothing is lost and nothing is recomputed: the amount,
-- the person who accepted the delivery and the moment they did are carried across, so a backfilled
-- line reads exactly like one typed today.
--
-- Only fees that were actually paid move. A `cod_shipping_fee` of 0 is the ordinary case — it means
-- the delivery was not COD, not that a zero-rupiah cost occurred.
INSERT INTO restock_cost_lines (restock_request_id, kind, amount, note, actor_id, created_at)
SELECT
    id,
    'cod_shipping',
    cod_shipping_fee,
    '',
    COALESCE(accepted_by_user_id, 0),
    COALESCE(accepted_at, updated_at, NOW())
FROM restock_requests
WHERE cod_shipping_fee > 0;

-- DROPPED, not kept alongside. Two places holding the same money is how they start disagreeing: every
-- reader would have to remember to add both, and the first one that forgets is silently wrong.
ALTER TABLE restock_requests DROP COLUMN cod_shipping_fee;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE restock_requests
    ADD COLUMN cod_shipping_fee BIGINT NOT NULL DEFAULT 0 CHECK (cod_shipping_fee >= 0);

-- Only the COD lines can go back — the column has nowhere to put any other kind, which is the whole
-- reason it was replaced. Rolling back therefore LOSES those lines' amounts from the request, and
-- that is the honest behaviour: inventing a column that silently absorbs them would make the freight
-- read as COD it never was.
UPDATE restock_requests r
SET cod_shipping_fee = c.total
FROM (
    SELECT restock_request_id, SUM(amount) AS total
    FROM restock_cost_lines
    WHERE kind = 'cod_shipping'
    GROUP BY restock_request_id
) c
WHERE c.restock_request_id = r.id;

DROP TABLE restock_cost_lines;
-- +goose StatementEnd
