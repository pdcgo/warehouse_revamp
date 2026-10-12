-- +goose Up
-- +goose StatementBegin
-- The address picker now enters through the KODE POS (owner): five digits are typed and the desa
-- that postcode covers are suggested, which is RegionSearchByKodePos's `kode_pos LIKE '237%'`.
--
-- Without this index that predicate is a sequential scan of 91.599 rows on every keystroke of a
-- debounced typeahead — the exact shape of query the name index already exists to avoid.
--
-- varchar_pattern_ops for the same reason regions_name_lower_idx uses text_pattern_ops: under a
-- non-C collation a plain btree cannot serve LIKE 'x%'.
--
-- PARTIAL, on the desa that have one: kode_pos is NULL for every level above desa (the table's own
-- CHECK enforces it), so ~7.837 of the rows are index entries that could never match anything.
CREATE INDEX regions_kode_pos_idx
    ON regions (kode_pos varchar_pattern_ops)
    WHERE kode_pos IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX regions_kode_pos_idx;
-- +goose StatementEnd
