-- +goose Up
-- +goose StatementBegin

-- THE DEVELOPMENT ROOT LOGS IN AS root / root1234 / root@pdc.com (dev-root-password-is-root1234), written here so a
-- fresh clone logs in with no extra step (the-migration-writes-the-dev-root-password).
--
-- The password is a bcrypt hash of root1234 (cost 10), never the plain text. ONLY WHILE ROOT HAS NONE: a database
-- whose root password was already set keeps it — without that condition this migration would reset a production
-- root back to a password that is public in this repository.
--
-- ⚠ Accepted risk: a FRESH production database starts with this public password until the operator runs
-- `san seed root`. 00003 created root with an empty password and has already run, so it is left as it was.
UPDATE users
SET password = '$2a$10$cjGQzGJ/bH2MRuS7PAvcB.K2fonlIwIEKwIddo0PfOEkgkK3ojlmu'
WHERE id = 1 AND password = '';

UPDATE users
SET email = 'root@pdc.com'
WHERE id = 1 AND email = 'root@system.local';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Undoes only what it wrote, and only where its own values are still there.
UPDATE users
SET password = ''
WHERE id = 1 AND password = '$2a$10$cjGQzGJ/bH2MRuS7PAvcB.K2fonlIwIEKwIddo0PfOEkgkK3ojlmu';

UPDATE users
SET email = 'root@system.local'
WHERE id = 1 AND email = 'root@pdc.com';
-- +goose StatementEnd
