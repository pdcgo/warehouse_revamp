-- +goose Up
-- +goose StatementBegin

-- A PRODUCT'S FORMER CODE STILL FINDS IT (backlog #152, #141 P4 — docs/business/product/context_decision.md:
-- a-team-code-change-recomposes-its-product-codes, its 🔄 *an old sticker scanned before the reprint*, owner Q1 "A"):
-- the product search — the seller's Products list (ProductList's `q`) and the warehouse's (SearchAmong: its list and its
-- picker) — also matches a code the product carried before, WHOLE and case-insensitively:
--
--     products.id IN (SELECT product_id FROM product_logs WHERE lower(old_code) = lower($q) AND kind = 'code_changed')
--
-- Every typed term asks it once per statement (a hashed sub-plan). Without this index that is a scan of the whole
-- history — 50 000 code_changed lines: 26 ms a statement, twice per ProductList page (count + page), ProductList's count
-- 53 ms; with it an index probe (0.014 ms) and the count 18 ms, HEAD's 22 ms
-- (audits/services/product_service/performances/ProductList.md). A PURE index (a-pure-index-is-added-without-asking): no
-- query or behaviour changes. The table's one writer — the team code change's recompose, one INSERT … SELECT of a history
-- line per product — measured inside its noise as a whole (20 000 products: +71 ms on 1.47 s, spread 227 ms); the
-- INSERT alone pays ≈ 6 µs a line (+120 ms on 632 ms). product_logs is append-only (no UPDATE), so no HOT path is lost.
CREATE INDEX product_logs_old_code_idx ON product_logs (lower(old_code));

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX product_logs_old_code_idx;
-- +goose StatementEnd
