# Acceptance — inventory / transaction

Every stock movement is one inventory transaction — a restock received, an order picked, a return, a sample, a transfer
out or in, a move, an adjustment, a broken, lost or found unit, a price correction — written to the batch ledger and the
rack ledger, and undone by a reversing entry, never deleted. A transaction has no action of its own: each is tested in
the feature that causes it. This file checks that the record reads right, on the warehouse's product page
(`/inventories/products/:id`): **Stock History** — every movement of the product here — and **Placement History** — the
put-aways and the moves between racks. Business: [transaction.md](../../business/inventory/transaction.md) · rules:
[guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">1</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to know what happened to a product's stock<br>(product X · received by a restock · picked for an order · moved from rack A to rack B · a sample taken)</td><td rowspan="2" valign="top">open stock history</td><td>every movement listed, newest first, with its kind: received, picked, moved, sample</td><td>✅ ok</td></tr>
<tr><td>each with its units, the stock after, who did it, its batch and its rack</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to know what happened to a product's stock<br>(product X · an order's stock taken · the order then cancelled)</td><td rowspan="1" valign="top">open stock history</td><td>the cancelled order's units shown coming back, as a cancel</td><td>✅ ok</td></tr>
<tr><td rowspan="2" valign="top">3</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to know what happened to a product's stock<br>(product X · 1 damaged by adjust · 1 found report approved)</td><td rowspan="2" valign="top">open stock history</td><td>the damaged unit shown as broken</td><td>✅ ok</td></tr>
<tr><td>the found unit shown as found</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to know what happened to a product's stock<br>(product X · transferred out to another warehouse · transferred in from another warehouse · returned by a buyer · recounted · price corrected)</td><td rowspan="1" valign="top">open stock history</td><td>each shown with its own kind: transferred out, transferred in, returned, counted, price corrected</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to know what happened to a product's stock<br>(product X in batch #12 and batch #13 · filter: batch #12)</td><td rowspan="1" valign="top">filter stock history</td><td>only batch #12's movements</td><td><a href="#the-batch-filter-names-a-batch-by-its-restock">❌ error</a></td></tr>
<tr><td rowspan="3" valign="top">6</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to know what happened to a product's stock<br>(10 product X received onto rack A · 10 moved from rack A to rack B · 2 picked from rack B for an order)</td><td rowspan="3" valign="top">open placement history</td><td>a row: received onto rack A, +10, with who and when</td><td><a href="#placement-history-leaves-out-the-receipt">❌ error</a></td></tr>
<tr><td>a row: moved from rack A to rack B, 10, with who and when</td><td>✅ ok</td></tr>
<tr><td>the 2 picked from rack B not listed here, only in stock history</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to know what happened to a product's stock<br>(product X moved on rack A and on rack B · filter: rack B)</td><td rowspan="1" valign="top">filter placement history</td><td>only rack B's movements</td><td>✅ ok</td></tr>
</table>

## Errors

### the-batch-filter-names-a-batch-by-its-restock

| | |
| --- | --- |
| then | `warehouse:all` wants to know what happened to a product's stock (product X in batch #12 and batch #13 · filter: batch #12) · filter stock history · only batch #12's movements |
| expected | the Stock History tab's Batch filter offers batch #12 as `#12` — the number its Batch column (and the batch's own page, *Batch #12*) gives it — and picking it leaves only batch #12's movements |
| actual | no option reads `#12`: batch #12's option reads `#8`, its restock's number. Picking that option does leave exactly batch #12's movements, none of batch #13's — the filtering is right, the name is not. Where a restock's number equals another batch's number, the option `#12` picks a different batch than the column's `#12` |
| cause | the filter's options are labelled by the batch's delivery (`label: #${b.deliveryId}`, [warehouse-product/index.tsx](../../../frontend/src/pages/warehouse-product/index.tsx#L161)), while the Batch column prints the batch's own id (`#${m.batchId}`, [MovementTable.tsx](../../../frontend/src/features/inventory/MovementTable.tsx#L202)) |
| seen | the e2e run for owner, admin and staff (2026-11-28, [20261128-065603-acceptance-filter-stock-history.md](../../../e2e_report/tester/20261128-065603-acceptance-filter-stock-history.md)) |
| check | `warehouse:owner filter stock history (…)` and the admin / staff tests of *warehouse:all wants to know what happened to a product's stock (product X in batch #12 and batch #13 · filter: batch #12)* in [transaction_warehouse_wants_to_open_stock_history.spec.ts](../../../frontend/e2e/transaction_warehouse_wants_to_open_stock_history.spec.ts), marked `test.fail` until this is fixed |

### placement-history-leaves-out-the-receipt

| | |
| --- | --- |
| then | `warehouse:all` wants to know what happened to a product's stock (10 product X received onto rack A · 10 moved from rack A to rack B · 2 picked from rack B for an order) · open placement history · a row: received onto rack A, +10, with who and when |
| expected | the product page's Placement History tab — *the put-aways and the moves between racks* — lists the restock's receipt: *Received*, rack A, +10, rack A at 10 after, the warehouse owner who accepted it, and its time |
| actual | the tab lists only the move's two legs (rack A −10, rack B +10, by the admin); the receipt onto rack A is not on it — it shows only on Stock History. The move's rows and the pick's absence are right |
| cause | Placement History is read as the product's StockHistory narrowed to one kind, the move (`filter: { productId, kind: moveKind }`, [features/inventory/queries.ts](../../../frontend/src/features/inventory/queries.ts#L198)), while a rack's *Hanya penempatan* lens reads both put-aways and moves (`PLACEMENT_KINDS`, [movementKind.ts](../../../frontend/src/features/inventory/movementKind.ts#L85)) |
| seen | the e2e run for owner, admin and staff (2026-11-28, [20261128-072100-acceptance-open-placement-history.md](../../../e2e_report/tester/20261128-072100-acceptance-open-placement-history.md)) |
| check | `warehouse:owner open placement history (…) — the receive` and the admin / staff tests of *warehouse:all wants to know what happened to a product's stock (10 product X received onto rack A · 10 moved from rack A to rack B · 2 picked from rack B for an order)* in [transaction_warehouse_wants_to_open_stock_history.spec.ts](../../../frontend/e2e/transaction_warehouse_wants_to_open_stock_history.spec.ts), marked `test.fail` until this is fixed |
