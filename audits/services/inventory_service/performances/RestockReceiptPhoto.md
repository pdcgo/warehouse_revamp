# RestockReceiptPhoto — performance audit

**Verdict:** 🟢 fast — **1 statement** in inventory (a primary-key lookup on `restocks`), ≈ 0.5 ms median wall, for the
restock's own warehouse and for another warehouse alike. document_service then signs from **1 more primary-key lookup**
on its own `documents` table (`LabelURL`, the statement `OrderLabels` already pays).
**Measured:** 2026-11-04 · `inventory_service/inventory_v1/restock_receipt_photo.go` (the document seam is the test's
`fakePhotoLinker`, so the figures are inventory's half) · **50 000 restocks** (five selling teams, three warehouses,
every one with a photo) · warm, 5 runs (`restock_receipt_photo_perf_test.go`, `-tags perfaudit`)

| call | median wall | statements |
| --- | --- | --- |
| the restock's own warehouse | 0.52 ms | 1 |
| another warehouse (NotFound) | 0.28 ms | 1 |

---

## Statements

| # | What | ×N | Time | Verdict |
| --- | --- | --- | --- | --- |
| 1 | the check — `SELECT id, team_id, warehouse_id, receipt_file FROM restocks WHERE id = ? AND warehouse_id = ? LIMIT 1` | 1 | 0.03 ms executed | ok — `restocks_pkey` index scan, `warehouse_id` a filter on the one row |
| 2 | (document_service, in-process) `documents WHERE id = ? AND team_id = ? AND resource_type = ? AND status = ? LIMIT 1` | 1 | not in this probe | ok — `documents.id` is the primary key, as in `OrderLabels`; then the signer mints the URL (the same signer `GetDownloadUrl` uses) |

---

## Findings

### one-row-by-its-key 🟢

The warehouse check rides the primary key — the id names one row, and `warehouse_id` filters it — so the cost does not
grow with the table or with how many restocks the warehouse has had. Another warehouse's call costs the same lookup and
never reaches document_service.

**→ Recommend:** nothing.
