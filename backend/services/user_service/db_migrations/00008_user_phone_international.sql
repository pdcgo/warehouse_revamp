-- +goose Up
-- +goose StatementBegin

-- A PHONE IS SAVED IN ONE FORM — `+`, the country code, the number (a-phone-is-saved-in-international-form). The
-- handlers rewrite every phone they save (normalizePhone); this rewrites the ones already stored, once
-- (stored-phones-are-rewritten-once), and puts one account per number behind a unique index
-- (a-phone-or-email-belongs-to-one-account).
--
-- user_phone_international is normalizePhone in SQL: NULL for a number it cannot read. A Go test holds the two to the
-- same answers (TestNormalizePhone_AgreesWithTheMigration).
CREATE FUNCTION user_phone_international(phone TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
    SELECT CASE
        WHEN t !~ '^\+?[0-9 ().-]+$' THEN NULL                    -- a-phone-has-8-to-15-digits: the shape
        WHEN length(d) NOT BETWEEN 8 AND 15 THEN NULL             -- … and the count
        WHEN t LIKE '+%' AND d LIKE '0%' THEN NULL                -- no country code starts with 0
        WHEN t LIKE '+%' THEN '+' || d
        WHEN d LIKE '0%' AND length(d) + 1 <= 15 THEN '+62' || substr(d, 2)
        WHEN d LIKE '0%' THEN NULL
        WHEN d LIKE '62%' THEN '+' || d
        ELSE NULL                                                 -- a-phone-starts-with-0-or-a-country-code
    END
    FROM (
        SELECT t, regexp_replace(t, '[^0-9]', '', 'g') AS d
        FROM (SELECT regexp_replace(phone, '^\s+|\s+$', '', 'g') AS t) AS trimmed
    ) AS parsed
$$;

-- Every readable stored number, rewritten. One it cannot read is LEFT AS IT IS — refused only when someone next edits
-- it; blanking it would quietly take a phone away.
UPDATE users
SET phone_number = user_phone_international(phone_number)
WHERE phone_number <> ''
  AND user_phone_international(phone_number) IS NOT NULL
  AND phone_number <> user_phone_international(phone_number);

-- Two accounts on one number STOP the migration, named, for a person to resolve. The whole migration is one
-- transaction, so the rewrite above is undone with it.
DO $$
DECLARE
    shared TEXT;
BEGIN
    SELECT string_agg(phone_number || ' (accounts ' || ids || ')', '; ')
    INTO shared
    FROM (
        SELECT phone_number, string_agg(id::text, ', ' ORDER BY id) AS ids
        FROM users
        WHERE phone_number <> ''
        GROUP BY phone_number
        HAVING count(*) > 1
    ) AS pairs;

    IF shared IS NOT NULL THEN
        RAISE EXCEPTION 'one phone is on more than one account — resolve before migrating (a-phone-or-email-belongs-to-one-account): %', shared;
    END IF;
END
$$;

CREATE UNIQUE INDEX users_phone_unique ON users (phone_number) WHERE phone_number <> '';

-- One form needs no comparison key: the search reads what is typed into the same form and compares the column.
DROP INDEX users_phone_key_idx;
DROP FUNCTION user_phone_key(TEXT);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- The rewritten numbers stay rewritten: the typed forms are gone, and the international one is a phone either way.
DROP INDEX users_phone_unique;

CREATE FUNCTION user_phone_key(phone TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
    SELECT CASE WHEN d LIKE '0%' THEN '62' || substr(d, 2) ELSE d END
    FROM (SELECT regexp_replace(phone, '[^0-9]', '', 'g') AS d) AS digits
$$;

CREATE INDEX users_phone_key_idx ON users (user_phone_key(phone_number)) WHERE phone_number <> '';

DROP FUNCTION user_phone_international(TEXT);
-- +goose StatementEnd
