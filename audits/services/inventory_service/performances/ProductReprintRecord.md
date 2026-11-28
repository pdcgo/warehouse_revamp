# ProductReprintRecord — performance audit

**Verdict:** 🟢 fast — **7 statements whatever the number of products** (no N+1): ≈ 15 ms for 50 products, ≈ 13.5 ms for
**500 at once** (a whole run of a 500-label device setup), at a warehouse where 5 000 products wait. The same rule's other
writer — a transfer accepted while its products are tagged (`WarehouseTransferAccept` → `ReprintArrivals`) — adds **4
statements, ≈ 22.5 ms for 500 products** to that accept.
**Measured:** 2026-11-27 · `inventory_service/inventory_v1/product_reprint_record.go` → the composition root's reader
(`backend/cmd/app_development/product_reader.go`) → `product_service/product_v1/product_reprint.go` (`RecordReprint`,
`AddArrivalReprintWaits`) · ProductReprintList.md's seed (100 000 background products; W1 5 000 waiting × 2 placements,
W2 5 000 waiting) · one process, each write in its own transaction (`product_reprint_perf_test.go`, `-tags perfaudit`)

| write | products | wall | statements |
| --- | --- | --- | --- |
| ProductReprintRecord | 50 | 15.3 ms | 7 |
| ProductReprintRecord | 500 | 13.5 ms | 7 |
| WarehouseTransferAccept's arrival waits (`ReprintArrivals`) | 500 | 22.5 ms | 4 |

---

## Statements (ProductReprintRecord, 500 products)

| # | What | ×N | Time | Verdict |
| --- | --- | --- | --- | --- |
| 1 | the owning teams — `SELECT DISTINCT team_id FROM products WHERE id = ANY(?)` | 1 | 1.1 ms | ok — `products_pkey` |
| 2 | the teams' product-code locks — `pg_advisory_xact_lock` over the distinct keys, in key order, ONE statement | 1 | ≈ 0.5–1.6 ms | ok — the same key as the team code change (`productCodeLockKey`), so a record, an arrival and a code change serialize per team |
| 3 | the live codes, under the locks — `SELECT id, product_code FROM products WHERE id = ANY(?)` | 1 | 2.1 ms, **0.17 ms executed** | ok — `products_pkey` |
| 4 | the app tag's id — `SELECT id FROM product_tags WHERE app_task = ?` | 1 | 1.1 ms, **0.01 ms executed** | ok — a one-page table |
| 5 | this warehouse's waits for the codes still live — `DELETE FROM product_reprint_waits WHERE warehouse_id = ? AND product_id = ANY(?) RETURNING product_id` | 1 | 2.9 ms | ok — the primary key `(product_id, warehouse_id)` |
| 6 | the tag off once no warehouse waits — `DELETE FROM product_tag_links l WHERE l.tag_id = ? AND l.product_id = ANY(the products printed with their live code) AND NOT EXISTS (SELECT 1 FROM product_reprint_waits w WHERE w.product_id = l.product_id) RETURNING l.product_id` | 1 | 5.5 ms | ok — one statement for the run |
| 7 | the SAVEPOINT / RELEASE of the in-process call | — | < 1 ms | — |

## Statements (the arrival waits, 500 products)

| # | What | ×N | Time | Verdict |
| --- | --- | --- | --- | --- |
| 1–2 | the owning teams and their product-code locks — as above | 1 + 1 | 1.6 ms | ok |
| 3 | `INSERT INTO product_reprint_waits (product_id, warehouse_id, since) SELECT DISTINCT w.product_id, ?, NOW() FROM product_reprint_waits w WHERE w.product_id = ANY(?) ON CONFLICT DO NOTHING` | 1 | 20.4 ms | ok — one insert for the transfer's lines; only a product some warehouse still waits for (still tagged) gets the receiving warehouse's wait |

No index was added; nothing was dropped. A write-path or lock-order change beyond these was not made.
