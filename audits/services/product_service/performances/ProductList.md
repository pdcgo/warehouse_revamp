# ProductList · SearchAmong · ProductCodesByIds (a former code finds its product) — performance audit

**Verdict:** ✅ **not heavy, with `product_logs_old_code_idx`** (migration 00012, a pure index —
`a-pure-index-is-added-without-asking`). Backlog #152 (#141 P4) adds one branch to the product search — the seller's
Products list (`ProductList` `q`) and the warehouse's (`SearchAmong`: its list and its picker):

```sql
… OR products.id IN (SELECT product_logs.product_id FROM product_logs
                     WHERE lower(product_logs.old_code) = lower($q) AND product_logs.kind = 'code_changed')
```

— a hashed sub-plan, run ONCE per statement. Without an index that sub-plan is a **seq scan of the whole history**
(50 000 lines: 26 ms), which put `ProductList`'s count past the 50 ms single-query line (53 ms) on a growing table.
With the index it is an index probe (0.014 ms) and the statements cost what HEAD's did. The pick pages' new batched read
(`ProductCodesByIds`, one per page, 200 ids) is 0.2–0.5 ms in the database.
**Measured:** 2026-11-27 · `product_v1/product_term_clause.go`, `product_list.go`, `product_search_among.go`,
`product_codes_by_ids.go` · `product_v1/product_former_codes_perf_test.go` (`TestPerf_FormerCodes`, `-tags perfaudit`)
· seed: 100 000 products in 5 teams, 50 000 `code_changed` lines (a former code each), a warehouse holding 6 000 of
another team's products (`SearchAmong`) · `warehouse_test`, warm, inside the test transaction (≈ 0.5 ms loopback a
statement) · MEDIAN of 7 after a warm-up · two rounds, WITHOUT then WITH the index (dropped / created + `ANALYZE` inside
the transaction), and HEAD's clause (`name ILIKE ? OR product_code ILIKE ?`) as the control, in one process.

## The statements (EXPLAIN ANALYZE, a former code typed)

| statement | HEAD's clause | WITHOUT the index | WITH the index | plan of the new branch |
| --- | --- | --- | --- | --- |
| `ProductList` count (run twice a page: count + page) | 22.4 ms | **53.3 ms** | **17.8 ms** | Seq Scan on product_logs 25.8 ms → Index Scan `product_logs_old_code_idx` 0.014 ms |
| `SearchAmong` page (6 000 held) | 15.1 ms | **48.4 ms** | **16.1 ms** | Seq Scan on product_logs 25.7 ms → Index Scan 0.019 ms |
| `ProductCodesByIds` (200 ids, the codes join) | — | 0.52 ms | 0.23 ms | `product_logs_product_idx` per product (ids bound on the log side) |

## The walls (median of 7, round 1 / round 2)

| call | WITHOUT | WITH | queries |
| --- | --- | --- | --- |
| ProductList · a former code | 100.8 / 95.2 ms | 54.7 / 68.1 ms | 3 |
| ProductList · a live code | 95.3 / 78.8 ms | 70.3 / 68.1 ms | 3 |
| SearchAmong 6 000 held · a former code | 100.7 / 86.1 ms | 59.3 / 62.6 ms | 2 |
| SearchAmong 6 000 held · a live code | 81.0 / 79.7 ms | 67.9 / 59.1 ms | 2 |
| ProductList · no term (control: never reads product_logs) | 89.4 / 85.4 ms | 55.0 / 53.5 ms | 2 |
| ProductCodesByIds · 200 ids | 2.3 / 1.7 ms | 1.6 / 2.2 ms | 2 |

⚠ **The walls are biased toward WITH**: the no-term control, which never touches `product_logs`, is ≈ 32 ms faster in
the WITH half too — the WITHOUT half runs first in each round, colder. Trust the EXPLAIN execution times above for the
gain (≈ 31–35 ms a statement, twice per `ProductList` page); the walls only show every call is under 150 ms either way.
Every read is paginated (`ProductList`: `page_size`; `SearchAmong`: its page; `ProductCodesByIds`: max 200 ids, one
call per pick page, read beside `StockPickLocations` in a `Promise.all`, only while the item scan is on screen).

## The writer — the index's cost

`product_logs` has one writer: the team code change's recompose (`RecomposeTeamCodes`, one `INSERT … SELECT` of a
history line per product). Append-only — no `UPDATE`, so no HOT path to lose. 20 000 products, rolled back each time (a
savepoint) so every pass writes the same rows; A-B-B-A three times over, one process:

| | WITHOUT | WITH | difference |
| --- | --- | --- | --- |
| the whole `RecomposeTeamCodes` (6 each) | median 1 474 ms (1 385–1 612) | median 1 545 ms (1 309–1 580, one 3 208 outlier) | +71 ms (+4.8 %) — inside the WITHOUT spread (227 ms) |
| the history `INSERT … SELECT` of 20 000 lines alone (6 medians of 5) | median 632 ms (563–696) | median 752 ms (570–803) | **+120 ms (+19 %)**, higher in every A-B-B-A block (+24, +107, +138 ms) |

The index's own cost is real and measurable on the statement — ≈ 6 µs a history line — and inside the noise of the call
a user waits on (a team code change, rare: once per team change). **Kept**, and reported: if the owner wants the writer
untouched, the options are (A) keep the index (today); (B) drop it and accept the 26 ms seq scan of the history per search
statement, growing with every code change; (C) a partial index `WHERE kind = 'code_changed'` — same write cost today
(every line is `code_changed`), smaller once other kinds land.

## History

| date | change | before → after |
| --- | --- | --- |
| 2026-11-27 | #152: a former code finds its product (`productTermClause`), `ProductCodesByIds`, `product_logs_old_code_idx` | ProductList count 22.4 → 17.8 ms, SearchAmong 15.1 → 16.1 ms (HEAD's clause → the new clause with the index); the clause without the index 53.3 / 48.4 ms |
