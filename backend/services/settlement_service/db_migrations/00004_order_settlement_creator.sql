-- +goose Up
-- +goose StatementBegin
-- WHO CREATED THE ORDER, frozen on its account (#the-creator-is-stamped-on-the-state-row).
--
-- Written ONCE, by the post that opens the account, and never changed. The per-user daily report
-- attributes every order-addressed movement to this person — so it must be on a table that survives a
-- replay. The event carries it too, but the event lives 31 days and this row lives forever.
--
-- ⚠ SET-ONCE IS DELIBERATE. If an account opened unattributed and the creator were filled in later, a
-- replay would attribute differently from the live fold that already ran: one number computed twice,
-- two answers.
--
-- 0 = not recorded — an account opened by an exporter's `fund` or a hand-posted row before the order's
-- own opening post.
ALTER TABLE order_settlements
    ADD COLUMN created_by_user_id BIGINT NOT NULL DEFAULT 0;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE order_settlements
    DROP COLUMN created_by_user_id;
-- +goose StatementEnd
