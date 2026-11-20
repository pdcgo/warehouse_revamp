-- +goose Up
-- +goose StatementBegin
-- CETAK ULANG LABEL (a-changed-label-asks-the-warehouse-to-reprint, a-parcel-marked-for-reprint-is-not-handed-over,
-- the-reprint-label-prototype-is-accepted): the system records when an order's label was printed and when its resi or
-- label file last changed. A change AFTER the print marks the order — on the warehouse list, Daftar Ambil, the pick page
-- and the print page — until the label is printed again, and the handover refuses it meanwhile.
--
--   label_printed_at    the print page's Print (OrderLabels with record_print) put this order's label in its PDF —
--                       stamped on every order the answer INCLUDED. NULL = never printed there; the order page's label
--                       viewer does not count.
--   receipt_changed_at  Edit Resi (OrderReceiptUpdate) last changed the number or the file. NULL = never; a request
--                       naming only what is there writes nothing.
--
--   marked = label_printed_at IS NOT NULL AND receipt_changed_at > label_printed_at
--            AND status IN ('pending', 'processed', 'picked')
--
-- ⚠ NO BACKFILL: no order printed before this migration carries a print record, so nothing is marked until the print
-- page records a print. Both stamps come from the database's clock (clock_timestamp()), so a change after a print reads
-- as after it whichever server made each.
ALTER TABLE orders ADD COLUMN label_printed_at timestamptz NULL;
ALTER TABLE orders ADD COLUMN receipt_changed_at timestamptz NULL;

-- PERLU CETAK ULANG's index (a-pure-index-is-added-without-asking): only the marked orders, by id — the list's
-- newest-first order — so the filtered page walks the few marked rows instead of every order shipping from the
-- warehouse, and the count and the tab counts read them alone. The predicate is the filter's own literal SQL
-- (selling_v1.reprintLabelCondition), which is what lets the planner use it under a generic plan too. Measured on
-- 50 000 orders, a warehouse shipping 16 667 of them, 38 marked (TestPerf_OrderList_ReprintLabel, medians of 7):
-- OrderList filtered 27.3 → 3.7 ms (generic plan 29.8 → 2.6 ms) — its count 13.9 → 0.11 ms, its page 19.6 → 0.24 ms —
-- and OrderStat filtered 10.7 → 1.5 ms (12.5 → 1.0 ms); the unfiltered list and stat unchanged.
CREATE INDEX orders_reprint_label_idx ON orders (id)
    WHERE label_printed_at IS NOT NULL AND receipt_changed_at > label_printed_at
      AND status IN ('pending', 'processed', 'picked');
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS orders_reprint_label_idx;
ALTER TABLE orders DROP COLUMN receipt_changed_at;
ALTER TABLE orders DROP COLUMN label_printed_at;
-- +goose StatementEnd
