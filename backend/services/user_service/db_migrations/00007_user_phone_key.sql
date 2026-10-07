-- +goose Up
-- +goose StatementBegin

-- How two phone numbers compare (managers-search-by-exact-username-phone-or-email, confirmed in Q20d): however
-- a number is written, it is one number. `0812-3456-7890`, `+62 812 3456 7890` and `62 812 3456 7890` all read
-- `6281234567890` — the digits only, a leading 0 read as Indonesia's trunk prefix.
--
-- Stored numbers are not touched. Whether a number is rewritten into one form when it is saved is user Q31; this
-- key is how two are compared either way. Not inlinable on purpose (it has a FROM), so the planner matches the
-- index below by the call itself.
CREATE FUNCTION user_phone_key(phone TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
    SELECT CASE WHEN d LIKE '0%' THEN '62' || substr(d, 2) ELSE d END
    FROM (SELECT regexp_replace(phone, '[^0-9]', '', 'g') AS d) AS digits
$$;

-- An Owner's exact search finds a person by phone through this, never by reading every account.
CREATE INDEX users_phone_key_idx ON users (user_phone_key(phone_number)) WHERE phone_number <> '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX users_phone_key_idx;
DROP FUNCTION user_phone_key(TEXT);
-- +goose StatementEnd
