-- +goose Up
-- +goose StatementBegin

-- The generated-file sweep (generated-files-are-kept-seven-days) takes the OLDEST generated downloads made before a
-- cutoff, a hundred at a time. Without this it scans the whole table — every receipt, statement and photo, kept
-- forever — once per hundred files. PARTIAL: only the three generated types, the ones the sweep asks about, so the
-- index holds about a week of rows however large the table grows. A pure index (a-pure-index-is-added-without-asking):
-- measured in audits/services/document_service/performances/SweepGeneratedFiles.md — the pick 43 ms → 0.7 ms and a
-- 2 000-file run 1.03 s → 0.14 s at 316 000 documents.
--
-- ⚠ The type list must match document_v1.generatedResourceTypes, which writes the same three as literals so the
-- planner can match this predicate.
CREATE INDEX documents_generated_created_idx ON documents (created_at, id)
    WHERE resource_type IN ('order_labels', 'table_export', 'order_export');
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX documents_generated_created_idx;
-- +goose StatementEnd
