# WarehouseTransferLabelPhoto — performance audit

**Verdict:** 🟢 fast — **1 statement** in inventory (a primary-key lookup on `warehouse_transfers`), ≈ 0.5 ms median
wall for every side and for a refused fourth team alike. document_service then signs from **1 more primary-key lookup**
on its own `documents` table (`LabelURL`, the statement `RestockReceiptPhoto` and `OrderLabels` already pay).
**Measured:** 2026-11-05 · `inventory_service/inventory_v1/warehouse_transfer_label_photo.go` (the document seam is the
test's `fakePhotoLinker`, so the figures are inventory's half) · **50 000 shipped transfers** (five selling teams, three
senders, three receivers, every one with a photo) · warm, 5 runs (`warehouse_transfer_label_photo_perf_test.go`,
`-tags perfaudit`)

| call | median wall | statements | executed |
| --- | --- | --- | --- |
| the sender A | ≈ 0.5 ms | 1 | 0.034 ms |
| the receiver B | ≈ 0.5 ms | 1 | 0.020 ms |
| the owning selling team | ≈ 0.5 ms | 1 | 0.019 ms |
| a fourth team (NotFound) | ≈ 0.5 ms | 1 | 0.020 ms |

The wall figures sit on Windows' ≈ 0.5 ms timer step (single runs read 0 s, 28 µs or 511–612 µs); the EXPLAIN
execution time is the real cost.

---

## Statements

| # | What | ×N | Time | Verdict |
| --- | --- | --- | --- | --- |
| 1 | the check — `SELECT id, from_warehouse_id, receipt_file FROM warehouse_transfers WHERE id = ? AND (team_id = ? OR from_warehouse_id = ? OR to_warehouse_id = ?) LIMIT 1` | 1 | 0.02–0.03 ms executed | ok — `warehouse_transfers_pkey` index scan; the three-side OR is a filter on the one row |
| 2 | (document_service, in-process) `documents WHERE id = ? AND team_id = ? AND resource_type = ? AND status = ? LIMIT 1` | 1 | not in this probe | ok — `documents.id` is the primary key, as in `RestockReceiptPhoto` |

---

## Findings

### one-row-by-its-key 🟢

The side check rides the primary key — the id names one row, and the three-side OR filters it — so the cost does not
grow with the transfers. No index is owed, and nothing to fix.
