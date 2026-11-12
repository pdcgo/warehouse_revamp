# MetricData and MetricSearch — the four inventory metrics — performance audit

**Verdict:** 🟡 — every read is **1 statement** (Transfer **2**: its movements, then in transit), no N+1, and a seller's or
a warehouse's read of any metric is **1–22 ms** at a busy year. Three reads cross the 150 ms line, all for the same
reason — they read most of a year of `inventory_stock_daily_changes` and that year (≈ 140 MB of heap) does not stay in
this host's 128 MB of shared buffers:

| read | median | why |
| --- | --- | --- |
| Restock / Returned stock / Transfer **headline for root** over a year | 310–330 ms | the root scan — a parallel seq scan of the year (finding 2) |
| Ready stock **by month over a year** for a seller | 230–900 ms (median 607) | one heap page per change row after the earliest edge (finding 1) |
| Ready stock **root's time search** over a year | 302 ms | both of the above |

One finding was fixed in the build by a pure index (finding 0, ✅ applied). Nothing else is applied: the two open ones
are a read-cost-vs-write-path trade-off for the owner.

**Measured:** 2026-11-12 · `inventory_service/inventory_v1/inventory_metric_{shared,restock,return,transfer,ready}.go`
via `MetricSearch` / `MetricData` (`lost_metric_search.go`, `lost_metric_data.go` dispatch) · warm, 5 runs, medians, a
clean `warehouse_test` (dead rows vacuumed) · [`inventory_metric_perf_test.go`](../../../../backend/services/inventory_service/inventory_v1/inventory_metric_perf_test.go)
`TestPerf_InventoryMetrics` (`-tags perfaudit`)

Background (one test transaction, `ANALYZE`d):

| table | rows | shape |
| --- | --- | --- |
| `inventory_stock_daily_changes` | ≈ 1 460 000 | 4 000 rows a day × 365 — 20 warehouses × 30 sellers × 10 000 products × 25 suppliers; every warehouse and seller every change type (half the rows orders) |
| `inventory_door_daily_reports` | 18 250 | 50 a day |
| `batches` | 200 000 | with units — 10 000 per warehouse, ≈ 6 700 per seller |
| `warehouse_transfers` | 2 000 | over the year, 2 out-leg log rows each; 5 % open, 5 % cancelled |

Gudang 5 is one warehouse of twenty, seller 100 one of thirty.

| metric | read | queries | median | in Go |
| --- | --- | --- | --- | --- |
| Restock | search — warehouse, by product, 365 days | 1 | 16.1 ms | 7 ms (ranks ≈ 9 000 keys) |
| Restock | search — seller, by day, 30 days | 1 | 1.1 ms | — |
| Restock | data — seller, 20 products, 365 days | 1 | 3.1 ms | — |
| Restock | data — **root, headline, 365 days** | 1 | **332 ms** | — |
| Returned stock | search — warehouse, by product, 365 days | 1 | 14.1 ms | 7 ms |
| Returned stock | search — seller, by day, 30 days | 1 | 1.1 ms | — |
| Returned stock | data — seller, 20 products, 365 days | 1 | 3.1 ms | — |
| Returned stock | data — **root, headline, 365 days** | 1 | **312 ms** | — |
| Transfer | search — warehouse, by day, 30 days, by *in transit* | 2 | 3.5 ms | — |
| Transfer | search — seller, by product, 365 days | 2 | 19.8 ms | 9 ms |
| Transfer | search — warehouse, by product, 365 days | 2 | 22.1 ms | 10 ms |
| Transfer | data — seller, 12 months | 2 | 15.4 ms | — |
| Transfer | data — **root, headline, 365 days** | 2 | **311 ms** | — |
| Ready stock | search — warehouse, by product (10 000 held), window ending today | 1 | 6.2 ms | 1 ms |
| Ready stock | data — warehouse, 30 days | 1 | 5.4 ms | — |
| Ready stock | data — **seller, 12 months** | 1 | **607 ms** (229–901) | — |
| Ready stock | data — seller, 20 products, window ending 180 days ago | 1 | 10.3 ms | — |
| Ready stock | data — root, headline, window ending today | 1 | 46.7 ms | — |
| Ready stock | search — **root, by day, 365 days** | 1 | **302 ms** | 11 ms |

MetricSearch ranks every key of the scope in Go (`rankKeys`): ≈ 9 000 product keys of a warehouse's year cost 7–10 ms
there — under the 40 % line at these sizes, and bounded by the reader's own products × the window.

---

## Finding 0 — a movement read walked every change type of the reader 🔴 → ✅ applied

The first indexes of `00042` were `(team_id, day)` and `(warehouse_id, day)`: Restock's read (`change_type = 'restock'`)
found the reader's rows of EVERY type in the window and filtered them on the heap — one page per row, ≈ 1.5 s for a
year. **Applied** in the same build, before the migration ever shipped (a pure index —
[a-pure-index-is-added-without-asking](../../../../docs/technical/architecture/context_decision.md#a-pure-index-is-added-without-asking);
no query, write or result change): the change type rides last, so a movement's read is judged in the index and visits
only its own rows, while Ready's (every type after the edge) still reads the `(…, day)` range — no third index on the
take's path:

```sql
CREATE INDEX inventory_stock_daily_changes_team_day_idx ON inventory_stock_daily_changes (team_id, day, change_type);
CREATE INDEX inventory_stock_daily_changes_warehouse_day_idx ON inventory_stock_daily_changes (warehouse_id, day, change_type);
```

| read (the first seed: each reader held only some change types) | `(…, day)` | `(…, day, change_type)` |
| --- | --- | --- |
| Restock data — seller, 20 products, 365 days | 1 433 ms | 5.9 ms |
| Returned stock data — seller, 20 products, 365 days | 1 484 ms | 1.1 ms |
| Transfer search — seller, by product, 365 days | 1 529 ms | 16.6 ms |
| Transfer data — seller, 12 months | 1 561 ms | 18.2 ms |

## Finding 1 — Ready stock far back reads one heap page per change after the edge 🟡 open

Ready reads a position **backwards from today** (decided:
[ready-stock-is-folded-in-the-stock-changes-own-step](../../../../docs/business/analytic/rpc_provide_decision.md#ready-stock-is-folded-in-the-stock-changes-own-step) —
*"a past day's position is read back from today's stock and the changes after that day"*): today's batches less every
change of the reader after the edge, of every type. A window ending today reads the batches alone (6 ms for 10 000 held
products); a year by month reads every change of the reader after the earliest edge — ≈ 48 000 rows for one seller,
spread over ≈ 18 000 heap pages, since a day's rows of every seller interleave as they are written. The index finds
them in 7 ms; the heap visit is the cost, and it is all I/O:

| seller 100, after the edge (committed + vacuumed copy of the year, `im_probe` schema, dropped after) | cold | warm |
| --- | --- | --- |
| 180 days, 20 products — 9 000 pages | 373 ms | **9 ms** (every page a buffer hit) |
| 364 days, by day — 18 000 pages | 2 466–3 335 ms | never warm: the pages outnumber the 128 MB of shared buffers |

**→ Options (the owner's — a write path or a denormalisation):**

- **A (recommended for now): leave it.** revamp has no real volume yet
  ([revamp-has-no-real-orders-yet](../../../../docs/business/order/context_decision.md#revamp-has-no-real-orders-yet));
  the probe's 4 000 change rows a day is a busy year, and a 30-day Ready view reads 5 ms. Re-run this probe when the
  table outgrows the production database's shared buffers.
- **B: a monthly net-change rollup** beside the daily table, keyed the same and folded in the same
  `StockTransaction` (one more upsert, last, on every stock write): a far edge reads whole months from it and only the
  edge month's days from the daily table — about 12× fewer rows for a year.
- **C, measured and not recommended: covering indexes** (`INCLUDE (warehouse_id | team_id, product_id, supplier_id,
  change_count, change_value)` on the two reader indexes). The planner never took an index-only scan — the reader's
  `warehouse_id = T OR team_id = T` is a BitmapOr — and it switched to a parallel seq scan (≈ 100 ms); every take's
  upsert would also stop being a HOT update (the counts it adds would sit in two indexes).

## Finding 2 — root's year is a scan of the year 🟡 open (the root scan)

Root reads every team's (`reader.all`, no reader condition), so a movement headline over a year matches no reader index
and reads the year's rows of every type: a parallel seq scan, 310–330 ms here; 125 ms on the committed and vacuumed
copy. It is the root scan the order metrics and Lost stock already accept (Lost: 30–40 ms over 219 000 rows), only over
a bigger table — the root team is the developers.

**→ Options (the owner's):** **A — leave it** (recommended: one team, no seller or warehouse waits on it); **B — an
index on `(change_type, day)`** for root's movement reads: a pure index, but a third one on every stock write's upsert,
the order take's included, so it is a write-path cost the standing OK does not cover. Not measured.

---

## Not measured

- a production network and buffer size: here each round trip is ~0.5 ms (Docker on Windows) and shared buffers are
  128 MB — every finding above is page I/O, so a production database holding the table in memory reads them in the
  warm column's time
- ⚠ **harness inflation**: the seed lives in one uncommitted test transaction (no visibility map, hint bits unset); and
  a test transaction ROLLED BACK by a killed run leaves its 1.46 M rows dead until autovacuum truncates them — an
  earlier run on such a database read every number above 2× slower. Run it on a clean `warehouse_test`
- the order take's added upsert — in [OrderTransactionCreate](OrderTransactionCreate.md#after-the-ready-fold-2026-11-12)

---

## Open questions

- Finding 1 — leave it, or a monthly rollup folded on every stock write?
- Finding 2 — leave root's year a scan, or a third index on the take's path?

---

## History

| Date | Ready seller, 12 months | Root headline, a year | Change |
| --- | --- | --- | --- |
| 2026-11-12 | 1 255 ms (the first seed) | 126–132 ms (the first seed) | first probe — the movement reads 1.4–1.6 s on `(…, day)` indexes |
| 2026-11-12 | 607 ms | 311–332 ms | `(…, day, change_type)` reader indexes (finding 0); the seed fixed so every warehouse and seller has every change type |
