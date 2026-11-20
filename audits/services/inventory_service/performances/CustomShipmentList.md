# CustomShipmentList — performance audit

**Verdict:** 🟡 one heavy case — **free text of one or two characters** (`q = "ab"`) reads every parcel line of every
team: ≈ 200–237 ms median over a warehouse that ships 35 000 parcels. Everything else is fast after `00058`
(the status tabs 1.4–2.5 ms, a search of three or more characters 19–40 ms, the all tab 6–10 ms), 3 statements a call,
no N+1.
**Measured:** 2026-11-19 · `inventory_service/inventory_v1/custom_shipment_list.go` · **70 000 parcels, 190 000 lines**
— one busy warehouse shipping 35 000 over three years (selling team 900 owns 30 000), the rest across 30 teams and 20
warehouses · warm, 7 runs after a warm-up, custom and generic plans (`custom_shipment_list_perf_test.go`,
`-tags perfaudit`: `TestPerf_CustomShipmentList`, `TestPerf_CustomShipmentListSearch`).

| case (warehouse 950, page 1) | without `00058` | with `00058` |
| --- | --- | --- |
| requested tab (the queue) | 7.2 ms | 1.8 ms |
| `q = budi` (a recipient) | 241 ms | 28 ms |
| `q = sku-42` (840 parcels) | 204 ms | 28 ms |
| `q = zzz` (none) | 190 ms | 40 ms |
| `q = #39990` (a number) | 177 ms | 37 ms |
| **`q = ab` (two letters)** | **200 ms** | **237 ms** — the same sequential plan |

---

## Findings

### a-short-term-reads-every-line

`applyCustomShipmentSearch` matches a line by `LOWER(product_code) LIKE '%q%' OR LOWER(name) LIKE '%q%'` (Postgres runs
it once per statement as a hashed subplan, twice a call — the count and the page). `00058`'s pg_trgm GIN index
(`custom_shipment_items_search_trgm_idx`) serves any term with a run of three characters; a term of one or two has no
trigram to look up, so the planner keeps the sequential scan of **every team's** parcel lines (190 000 here): ≈ 70 ms
per statement, ≈ 200 ms a call, growing with the platform's lines, not the reader's.

- **Measured, not built — `id IN (SELECT custom_shipment_id …)` instead of the EXISTS**: no gain (PG 17 already hashes
  the EXISTS): 80 → 88 ms per statement, same counts.

**→ Recommend (a behaviour change — the owner's call):** **A** the list screen searches from the third character (a
shorter term keeps the rows as they are — the minimum term an unbounded search select already has, `UserSelect`, `ProductSelect`) — nothing on the server; **B** a term
under three characters matches only the number and the recipient, never a line (the server, one `if`); **C** leave it —
a two-letter search over a busy warehouse costs ≈ 0.2 s. A is the cheapest and matches what a person types.

---

## History

| date | change | effect |
| --- | --- | --- |
| 2026-11-19 | built (#88 P2) with `00058`: `(team_id, status, id DESC)`, `(warehouse_id, status, id DESC)`, the lines' trigram GIN | tabs 7–9 → 1.4–2.5 ms; 3+ character search 144–241 → 19–40 ms; 1–2 characters unchanged (this finding) |

**Resolved 2026-11-19 (dev bot, by precedent — not asked):** C, left as it is. The owner rejected a letter minimum on search (`a-product-picker-needs-no-two-letters`, *"harusnya tidak perlu minimal 2 huruf"*), and the order search keeps its old scan for a term with no 3-character run (`the-order-search-matches-ids-first`); ~200 ms at 70,000 parcels for a 1–2 character term is within the audit budget for a not-yet-live screen. Revisit only if real volume makes it a finding.
