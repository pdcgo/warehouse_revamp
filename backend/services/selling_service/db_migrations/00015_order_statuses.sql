-- +goose Up
-- +goose StatementBegin
-- THE ELEVEN STATUSES (the-status-move-is-the-only-journey). Every order and every history row moves
-- from the old six, by the mapping the owner agreed (2026-10-21):
--
--   placed → pending · confirmed → processed · picking → processed · packed → picked
--   shipped → shipping (the old `shipped` was the HANDOVER, which the new `shipping` is) · cancelled → cancel
--
-- Old `picking` has no status of its own any more: an order being picked is still `processed` until
-- the warehouse sets it picked.
UPDATE orders
SET status = CASE status
    WHEN 'placed'    THEN 'pending'
    WHEN 'confirmed' THEN 'processed'
    WHEN 'picking'   THEN 'processed'
    WHEN 'packed'    THEN 'picked'
    WHEN 'shipped'   THEN 'shipping'
    WHEN 'cancelled' THEN 'cancel'
    ELSE status
END;

ALTER TABLE orders
    ALTER COLUMN status SET DEFAULT 'pending';

-- A history row's kind is the status it moved INTO, so it moves by the same mapping.
UPDATE order_events
SET kind = CASE kind
    WHEN 'placed'    THEN 'pending'
    WHEN 'confirmed' THEN 'processed'
    WHEN 'picking'   THEN 'processed'
    WHEN 'packed'    THEN 'picked'
    WHEN 'shipped'   THEN 'shipping'
    WHEN 'cancelled' THEN 'cancel'
    ELSE kind
END;

-- WHY, when a move needed a reason: required for a move back to pending
-- (one-status-change-for-every-plain-move), '' for every other move and every row written before.
ALTER TABLE order_events
    ADD COLUMN note TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- ⚠ REFUSED when an order already stands in a status the old six cannot say. The new `shipped`, in
-- particular, would read as the old `shipped` (the handover) and quietly move an order backwards.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM orders
        WHERE status IN ('shipped', 'completed', 'problem', 'lost', 'return', 'return_completed')
    ) OR EXISTS (
        SELECT 1 FROM order_events
        WHERE kind IN ('shipped', 'completed', 'problem', 'lost', 'return', 'return_completed')
    ) THEN
        RAISE EXCEPTION 'orders or history use a status the old six cannot express; not rolling back';
    END IF;
END $$;

ALTER TABLE order_events
    DROP COLUMN note;

-- `processed` goes back as `confirmed`: whether an order was mid-pick is not recoverable.
UPDATE order_events
SET kind = CASE kind
    WHEN 'pending'   THEN 'placed'
    WHEN 'processed' THEN 'confirmed'
    WHEN 'picked'    THEN 'packed'
    WHEN 'shipping'  THEN 'shipped'
    WHEN 'cancel'    THEN 'cancelled'
    ELSE kind
END;

ALTER TABLE orders
    ALTER COLUMN status SET DEFAULT 'placed';

UPDATE orders
SET status = CASE status
    WHEN 'pending'   THEN 'placed'
    WHEN 'processed' THEN 'confirmed'
    WHEN 'picked'    THEN 'packed'
    WHEN 'shipping'  THEN 'shipped'
    WHEN 'cancel'    THEN 'cancelled'
    ELSE status
END;
-- +goose StatementEnd
