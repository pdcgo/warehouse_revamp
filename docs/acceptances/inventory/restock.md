# Acceptance — inventory / restock

Business: [restock.md](../../business/inventory/restock.md) · rules: [guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="6" valign="top"><code>selling:all</code> wants to restock<br>(1 product · 1 warehouse · operational account · no shipping cost)</td><td rowspan="6" valign="top">create restock</td><td>restock created with 1 product</td><td>✅ ok</td></tr>
<tr><td>1 product recorded at warehouse</td><td>✅ ok</td></tr>
<tr><td>ongoing stock of 1 product increases</td><td>✅ ok</td></tr>
<tr><td>operational account balance decreases by product total</td><td>✅ ok</td></tr>
<tr><td>recorded in operational account history</td><td>✅ ok</td></tr>
<tr><td>restock recorded in analytic metric</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="6" valign="top"><code>selling:all</code> wants to restock<br>(2 products · 1 warehouse · operational account · no shipping cost)</td><td rowspan="6" valign="top">create restock</td><td>restock created with 2 products</td><td>✅ ok</td></tr>
<tr><td>2 products recorded at warehouse</td><td>✅ ok</td></tr>
<tr><td>ongoing stock of 2 products increases</td><td>✅ ok</td></tr>
<tr><td>operational account balance decreases by product total</td><td>✅ ok</td></tr>
<tr><td>recorded in operational account history</td><td>✅ ok</td></tr>
<tr><td>restock recorded in analytic metric</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="6" valign="top"><code>selling:all</code> wants to restock<br>(1 product · 1 warehouse · operational account · shipping cost)</td><td rowspan="6" valign="top">create restock</td><td>restock created with 1 product and shipping cost</td><td>✅ ok</td></tr>
<tr><td>1 product recorded at warehouse</td><td>✅ ok</td></tr>
<tr><td>ongoing stock of 1 product increases</td><td>✅ ok</td></tr>
<tr><td>operational account balance decreases by product total + shipping cost</td><td>✅ ok</td></tr>
<tr><td>recorded in operational account history</td><td>✅ ok</td></tr>
<tr><td>restock recorded in analytic metric</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top"><code>warehouse:all</code> wants to receive a restock<br>(status: ongoing · no COD)</td><td rowspan="2" valign="top">mark arrived restock</td><td>status changed from ongoing to arrived</td><td>✅ ok</td></tr>
<tr><td>receiver and time recorded</td><td>✅ ok</td></tr>
<tr><td rowspan="2" valign="top"><code>warehouse:all</code> wants to receive a restock<br>(status: lost · no COD)</td><td rowspan="2" valign="top">mark arrived restock</td><td>status changed from lost to arrived</td><td>✅ ok</td></tr>
<tr><td>receiver and time recorded</td><td>✅ ok</td></tr>
<tr><td><code>warehouse:all</code> wants to receive a restock<br>(status: ongoing · COD)</td><td>mark arrived restock</td><td>COD recorded on restock</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="9" valign="top"><code>warehouse:all</code> wants to accept a restock<br>(status: arrived · all received · new product · no COD · 1 supplier)</td><td rowspan="9" valign="top">accept restock</td><td>status changed from arrived to accepted</td><td>✅ ok</td></tr>
<tr><td>ready stock increases by all received</td><td>✅ ok</td></tr>
<tr><td>ongoing stock decreases by all received</td><td>✅ ok</td></tr>
<tr><td>all received on rack</td><td>✅ ok</td></tr>
<tr><td>price set on batch</td><td>✅ ok</td></tr>
<tr><td>recorded in product history</td><td>⬜ untested</td></tr>
<tr><td>new product listed in warehouse</td><td>⬜ untested</td></tr>
<tr><td>recorded at 1 supplier</td><td>⬜ untested</td></tr>
<tr><td>all received recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="10" valign="top"><code>warehouse:all</code> wants to accept a restock<br>(status: ongoing · all received · new product · no COD · 1 supplier)</td><td rowspan="10" valign="top">accept restock</td><td>status changed from ongoing to accepted</td><td>✅ ok</td></tr>
<tr><td>ready stock increases by all received</td><td>✅ ok</td></tr>
<tr><td>ongoing stock decreases by all received</td><td>✅ ok</td></tr>
<tr><td>all received on rack</td><td>✅ ok</td></tr>
<tr><td>price set on batch</td><td>✅ ok</td></tr>
<tr><td>receiver and time recorded</td><td>✅ ok</td></tr>
<tr><td>recorded in product history</td><td>⬜ untested</td></tr>
<tr><td>new product listed in warehouse</td><td>✅ ok</td></tr>
<tr><td>recorded at 1 supplier</td><td>✅ ok</td></tr>
<tr><td>all received recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top"><code>warehouse:all</code> wants to accept a restock<br>(status: ongoing · brokens thrown away · new product · no COD · 1 supplier)</td><td rowspan="4" valign="top">accept restock</td><td>status changed from ongoing to accepted</td><td>✅ ok</td></tr>
<tr><td>ready stock increases, brokens excluded</td><td>✅ ok</td></tr>
<tr><td>brokens thrown away recorded</td><td>✅ ok</td></tr>
<tr><td>brokens recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>warehouse:all</code> wants to accept a restock<br>(status: ongoing · brokens on rack · new product · no COD · 1 supplier)</td><td rowspan="2" valign="top">accept restock</td><td>brokens on rack</td><td>🚧 unimplemented</td></tr>
<tr><td>brokens recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="4" valign="top"><code>warehouse:all</code> wants to accept a restock<br>(status: ongoing · missing items · new product · no COD · 1 supplier)</td><td rowspan="4" valign="top">accept restock</td><td>status changed from ongoing to accepted</td><td>✅ ok</td></tr>
<tr><td>ready stock increases, missing items excluded</td><td>✅ ok</td></tr>
<tr><td>missing items recorded</td><td>✅ ok</td></tr>
<tr><td>missing items recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>warehouse:all</code> wants to accept a restock<br>(status: ongoing · all received · listed product · no COD · 1 supplier)</td><td rowspan="2" valign="top">accept restock</td><td>listed product not listed again</td><td>✅ ok</td></tr>
<tr><td>all received recorded in analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top"><code>warehouse:all</code> wants to accept a restock<br>(status: ongoing · all received · new product · COD · 1 supplier)</td><td rowspan="3" valign="top">accept restock</td><td>COD recorded on restock</td><td>✅ ok</td></tr>
<tr><td>COD recorded in liability</td><td>✅ ok</td></tr>
<tr><td>COD recorded in analytic metric</td><td>🚧 unimplemented</td></tr>
<tr><td><code>warehouse:all</code> wants to accept a restock<br>(status: ongoing · all received · new product · no COD · multi suppliers)</td><td>accept restock</td><td>recorded at each supplier</td><td><a href="#a-multi-supplier-restock-is-recorded-at-no-supplier">❌ error</a></td></tr>
<tr><td rowspan="8" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 1 product · add product · 1 warehouse · operational account)</td><td rowspan="8" valign="top">edit restock</td><td>new product added</td><td>✅ ok</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>ongoing total adjusted</td><td>✅ ok</td></tr>
<tr><td>total warehouse receive changes</td><td>✅ ok</td></tr>
<tr><td>paying account balance adjusted (decrease)</td><td>✅ ok</td></tr>
<tr><td>edit recorded in account history</td><td>✅ ok</td></tr>
<tr><td>edit recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td>restock analytic metric adjusted</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="8" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 1 product · change product · 1 warehouse · operational account)</td><td rowspan="8" valign="top">edit restock</td><td>restock shows new count, total and note</td><td>✅ ok</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>ongoing total adjusted</td><td>✅ ok</td></tr>
<tr><td>total warehouse receive changes</td><td>✅ ok</td></tr>
<tr><td>paying account balance adjusted (decrease/increase)</td><td>✅ ok</td></tr>
<tr><td>edit recorded in account history</td><td>✅ ok</td></tr>
<tr><td>edit recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td>restock analytic metric adjusted</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="8" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 2 products · remove product · 1 warehouse · operational account)</td><td rowspan="8" valign="top">edit restock</td><td>product removed</td><td>✅ ok</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>ongoing total adjusted</td><td>✅ ok</td></tr>
<tr><td>total warehouse receive changes</td><td>✅ ok</td></tr>
<tr><td>paying account balance adjusted (increase)</td><td>✅ ok</td></tr>
<tr><td>edit recorded in account history</td><td>✅ ok</td></tr>
<tr><td>edit recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td>restock analytic metric adjusted</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 1 product · change supplier and store · 1 warehouse · operational account)</td><td rowspan="2" valign="top">edit restock</td><td>restock shows new supplier and store</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td rowspan="5" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 1 product · change warehouse · 2 warehouses · operational account)</td><td rowspan="5" valign="top">edit restock</td><td>restock shows new warehouse</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>recorded at new warehouse</td><td>⬜ untested</td></tr>
<tr><td>removed from old warehouse</td><td>⬜ untested</td></tr>
<tr><td>restock analytic metric adjusted</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="7" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 1 product · change account · 1 warehouse · 2 operational accounts)</td><td rowspan="7" valign="top">edit restock</td><td>restock shows new account</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>old account balance back up</td><td>⬜ untested</td></tr>
<tr><td>new account balance decreases</td><td>⬜ untested</td></tr>
<tr><td>move recorded in old account history</td><td>⬜ untested</td></tr>
<tr><td>move recorded in new account history</td><td>⬜ untested</td></tr>
<tr><td>move recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 1 product · change order ID, courier, tracking and receipt photo · 1 warehouse · operational account)</td><td rowspan="3" valign="top">edit restock</td><td>restock shows new order ID, courier, tracking and photo</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>target warehouse sees new courier and tracking</td><td>⬜ untested</td></tr>
<tr><td rowspan="6" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 1 product · change shipping cost · 1 warehouse · operational account)</td><td rowspan="6" valign="top">edit restock</td><td>restock shows new shipping cost</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>paying account balance follows difference</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in account history</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td>restock analytic metric adjusted</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="3" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: ongoing · 1 product · change restock note · 1 warehouse · operational account)</td><td rowspan="3" valign="top">edit restock</td><td>restock shows new note</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>target warehouse sees new note</td><td>⬜ untested</td></tr>
<tr><td rowspan="8" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: arrived · 1 product · add product · 1 warehouse · operational account)</td><td rowspan="8" valign="top">edit restock</td><td>new product added</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>ongoing total adjusted</td><td>⬜ untested</td></tr>
<tr><td>total warehouse receive changes</td><td>⬜ untested</td></tr>
<tr><td>paying account balance adjusted (decrease)</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in account history</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td>restock analytic metric adjusted</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="8" valign="top"><code>selling:all</code> wants to edit a restock<br>(status: arrived · 1 product · change product · 1 warehouse · operational account)</td><td rowspan="8" valign="top">edit restock</td><td>restock shows new count, total and note</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in restock timeline</td><td>⬜ untested</td></tr>
<tr><td>ongoing total adjusted</td><td>⬜ untested</td></tr>
<tr><td>total warehouse receive changes</td><td>⬜ untested</td></tr>
<tr><td>paying account balance adjusted (decrease/increase)</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in account history</td><td>⬜ untested</td></tr>
<tr><td>edit recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td>restock analytic metric adjusted</td><td>🚧 unimplemented</td></tr>
</table>

## Not discussed yet

These are the restock actions the system performs today, read from
[restock_request.proto](../../../proto/warehouse/inventory/v1/restock_request.proto). Each one's given + when is settled
only when it is discussed, so the states below are a starting point, not a decision.

| given | when |
| --- | --- |
| `selling:all` wants to cancel a restock<br>(ongoing) | cancel ← next |
| `selling:all` wants to report a lost restock<br>(ongoing) | set lost |

## Errors

### a-multi-supplier-restock-is-recorded-at-no-supplier

| | |
| --- | --- |
| then | `warehouse:all` wants to accept a restock (status: ongoing · all received · new product · no COD · multi suppliers) · accept restock · recorded at each supplier |
| expected | each line is recorded at its own supplier |
| actual | the restock is recorded at **no** supplier: neither supplier's Statistics shows its products. The goods still enter ready stock, and the accept itself succeeds |
| cause | supplier_service records a restock under ONE supplier for the whole restock. When the lines name different suppliers, that supplier is 0, and the restock is skipped ([restock_accepted_event.go](../../../backend/services/inventory_service/inventory_v1/restock_accepted_event.go#L146), [analytic_fold.go](../../../backend/services/supplier_service/supplier_v1/analytic_fold.go#L140)) |
| seen | the owner's check on the dev data (2026-11-11), and the e2e run for every warehouse role |
| check | `warehouse:all accept restock (status: ongoing · all received · new product · no COD · multi suppliers)` in [restock.spec.ts](../../../frontend/e2e/restock.spec.ts), marked `test.fail` until this is fixed |
