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
<tr><td rowspan="2" valign="top">1</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to know what happened to a product's stock<br>(product X · received by a restock · picked for an order · moved from rack A to rack B · a sample taken)</td><td rowspan="2" valign="top">open stock history</td><td>every movement listed, newest first, with its kind: received, picked, moved, sample</td><td>⬜ untested</td></tr>
<tr><td>each with its units, the stock after, who did it, its batch and its rack</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to know what happened to a product's stock<br>(product X · an order's stock taken · the order then cancelled)</td><td rowspan="1" valign="top">open stock history</td><td>the cancelled order's units shown coming back, as a cancel</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">3</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to know what happened to a product's stock<br>(product X · 1 damaged by adjust · 1 found report approved)</td><td rowspan="2" valign="top">open stock history</td><td>the damaged unit shown as broken</td><td>⬜ untested</td></tr>
<tr><td>the found unit shown as found</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to know what happened to a product's stock<br>(product X in batch #12 and batch #13 · filter: batch #12)</td><td rowspan="1" valign="top">filter stock history</td><td>only batch #12's movements</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">5</td><td rowspan="3" valign="top"><code>warehouse:all</code> wants to know what happened to a product's stock<br>(10 product X received onto rack A · 10 moved from rack A to rack B · 2 picked from rack B for an order)</td><td rowspan="3" valign="top">open placement history</td><td>a row: received onto rack A, +10, with who and when</td><td>⬜ untested</td></tr>
<tr><td>a row: moved from rack A to rack B, 10, with who and when</td><td>⬜ untested</td></tr>
<tr><td>the 2 picked from rack B not listed here, only in stock history</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to know what happened to a product's stock<br>(product X moved on rack A and on rack B · filter: rack B)</td><td rowspan="1" valign="top">filter placement history</td><td>only rack B's movements</td><td>⬜ untested</td></tr>
</table>
