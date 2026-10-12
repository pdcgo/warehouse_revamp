-- +goose Up
-- +goose StatementBegin
-- `stock_batches.accepted_at` DEFAULTs to NOW(), but the insert goes through GORM and the field is a
-- non-pointer time.Time — so GORM always includes it in the INSERT, and an unset one wrote the ZERO
-- time (0001-01-01) straight over the default. Every batch accepted before that was fixed therefore
-- claims to have arrived in the year 1.
--
-- It stayed invisible while nothing read the column: a page that only prints a date shows an odd year
-- and nothing else breaks. It stopped being invisible the moment the owner's product list started
-- ANSWERING with it — "oldest batch" and "last restock" both came back as year 1, which the UI then
-- had to render as "we do not know".
--
-- created_at is the honest stand-in: both are stamped in the same transaction as a delivery is
-- accepted, so for these rows they were always the same moment.
UPDATE stock_batches
SET accepted_at = created_at
WHERE accepted_at < TIMESTAMPTZ '2000-01-01';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Deliberately a no-op. The old values were a bug, not a state worth restoring, and a zero time
-- written back would be indistinguishable from one this migration never touched.
SELECT 1;
-- +goose StatementEnd
