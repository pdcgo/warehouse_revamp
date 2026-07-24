-- +goose Up
-- +goose StatementBegin
-- Indonesia's administrative regions: provinsi -> kabupaten/kota -> kecamatan -> desa/kelurahan.
--
-- ONE self-referential table (plan §4.2 option A, owner call), not four typed tables: the source
-- (cahyadsn/wilayah) is exactly this shape, so the seed is a near-verbatim load, and "children of X"
-- is one indexed predicate instead of a per-level table choice.
--
-- This is GLOBAL reference data — not team-scoped. There is no team_id and no use_scope; every
-- authenticated user reads the same regions (plan §4.4).
--
-- The ROWS are not loaded here. 91.599 of them arrive by COPY from the generated CSV seed:
--   cd backend && go run ./cmd/tool region load-seed
-- (see db_migrations/seed/README.md). Postgres runs in Docker and cannot read a host file, so a
-- server-side COPY ... FROM '<path>' in this migration would not work; the client-side load matches
-- how the category taxonomy is seeded from a file.
CREATE TABLE regions (
    -- The dotted kode wilayah: '11' / '11.01' / '11.01.01' / '11.01.01.2001'. It IS the identity —
    -- the government's key, stable across our system, and what a snapshot stores.
    code        VARCHAR(20) PRIMARY KEY,

    -- The code with its last segment removed; NULL for a provinsi. A real self-FK: the hierarchy is
    -- the whole point of the table, and an orphan is a picker that dead-ends. The seed is sorted by
    -- code, so every parent is inserted before its children.
    parent_code VARCHAR(20) REFERENCES regions (code) ON DELETE CASCADE,

    -- 1=provinsi 2=kabupaten/kota 3=kecamatan 4=desa/kelurahan. A fixed 4-tier structure set by law,
    -- so a range CHECK is safe here — unlike an enum IN-list, this cannot drift as data grows (#80).
    level       SMALLINT    NOT NULL,

    name        TEXT        NOT NULL,

    -- Level 4 only. Officially one kode pos per desa/kelurahan, so it is a column, not a table.
    -- Nullable: complete in the current edition, but a future revision may add a desa without one.
    kode_pos    VARCHAR(5),

    CONSTRAINT regions_level_range CHECK (level BETWEEN 1 AND 4),
    CONSTRAINT regions_name_present CHECK (name <> ''),
    -- A kode pos belongs to a desa and nowhere else.
    CONSTRAINT regions_kode_pos_level_4 CHECK (kode_pos IS NULL OR level = 4)
);

-- The cascading picker's only query: "children of X" (and "the provinsi" = parent_code IS NULL).
CREATE INDEX regions_parent_code_idx ON regions (parent_code);

-- Typeahead over name. Case-insensitive PREFIX search (LOWER(name) LIKE 'kra%') is what a picker
-- does; text_pattern_ops is what makes that use the index. A leading-wildcard "contains" search
-- would need pg_trgm — add it only if RegionSearch turns out to need infix matching.
CREATE INDEX regions_name_lower_idx ON regions (LOWER(name) text_pattern_ops);

-- Level is a natural filter for a scoped search ("find a kecamatan named X").
CREATE INDEX regions_level_idx ON regions (level);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE regions;
-- +goose StatementEnd
