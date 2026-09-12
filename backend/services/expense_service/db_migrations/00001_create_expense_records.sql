-- +goose Up
-- MONEY THAT NO ORDER CAUSED (#161).
--
-- revenue_service already knows what an order earned. This is everything the business spent that no
-- order asked for: the ads budget that brought the buyers in, the people who packed the boxes, the
-- electricity that kept the lights on.
--
-- The defining fact is that A PERSON TYPES IT. A revenue row is written by the system from an order
-- and frozen; a cost row is entered by hand, about a period, and can therefore be wrong — so it is
-- correctable, and it records who entered it.
CREATE TABLE expense_records (
    id BIGSERIAL PRIMARY KEY,

    -- The scope, exactly as on a revenue row. ONE team per row (owner, 2026-07-21): a warehouse IS a
    -- team, so warehouse payroll is a cost on that warehouse's team_id, and it is never recharged
    -- onward to the selling teams it fulfils for. A recharge would have been a second team here,
    -- which is why it was settled before this file was written.
    team_id BIGINT NOT NULL,

    -- OPTIONALLY the shop the money was spent on. 0 = not attributed to one shop.
    --
    -- Optional on EVERY kind (owner), not only ads: a team running two shops may split its packing
    -- wages or a subscription between them. Opaque selling_service id — no FK across services.
    shop_id BIGINT NOT NULL DEFAULT 0,

    -- ExpenseKind as its enum NUMBER. Mapped in the handler, not by a DB CHECK IN-list (cf. #80): proto
    -- enums are open and append-only, so a CHECK here would reject a kind the contract already
    -- allows the day one is added.
    kind INT NOT NULL,

    -- Whole rupiah, ALWAYS POSITIVE. The kind already says the money is going out, so a signed amount
    -- would let a negative cost silently become revenue.
    amount BIGINT NOT NULL CHECK (amount > 0),

    -- The date the cost BELONGS TO, chosen by the person — not the insert timestamp. Payroll is paid
    -- on the 5th for the month before, and filing it under the 5th puts it in the wrong month for
    -- every report that matters. A DATE, not a timestamp: nobody records the hour rent was paid.
    occurred_at DATE NOT NULL,

    -- What it actually was. The kind says which bucket; this says which electricity bill.
    note TEXT NOT NULL DEFAULT '',

    -- WHO TYPED IT. This number moves profit directly and a person entered it by hand, so the row
    -- says whose number it is. Opaque user_service id — no FK across services.
    created_by BIGINT NOT NULL,

    -- NULL while it still counts (#164's pattern). A cost entered by mistake is VOIDED, not deleted:
    -- a deleted row cannot tell you a cost was entered and then retracted, and somebody looking at a
    -- profit figure that changed wants to see why.
    voided_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The one read this table exists for: a team's costs for a PERIOD, newest first. Every screen and
-- every total starts here, and they all say "the live ones", so the predicate rides on the index.
CREATE INDEX expense_records_team_period_idx
    ON expense_records (team_id, occurred_at DESC, id DESC)
    WHERE voided_at IS NULL;

-- +goose Down
DROP TABLE expense_records;
