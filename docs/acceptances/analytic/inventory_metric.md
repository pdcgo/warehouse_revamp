# Acceptance — analytic / inventory_metric

The five inventory metrics on **Analitik**, all in units — *Restok* (good units accepted, broken at the door, missing),
*Transfer* (sent, received, in transit), *Stok retur* (back on the shelf, broken, never came back), *Stok siap* (ready
at the period's edge) and *Stok hilang* (written off). A rupiah value beside a count is the seller's money and is
not shown to a warehouse, except ready and lost stock. 🚧 rows are what [restock](../inventory/restock.md) records *in
analytic metric* while the restock metric counts only accepted units. Rules: [guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top">1</td><td rowspan="3" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · restock · restock accepted today: 8 good · 1 broken · 1 missing)</td><td rowspan="3" valign="top">add analytic metric</td><td>accepted 8 with its value</td><td>⬜ untested</td></tr>
<tr><td>broken 1</td><td>⬜ untested</td></tr>
<tr><td>missing 1</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to see statistics<br>(group daily · restock · restock accepted today: 8 good · 1 broken · 1 missing)</td><td rowspan="1" valign="top">add analytic metric</td><td>value column not shown</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · transfer · 5 units sent · 3 received · 2 in transit)</td><td rowspan="1" valign="top">add analytic metric</td><td>sent 5, received 3, in transit 2</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">4</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · returned stock · return of 3 units: 2 back on the shelf · 1 broken)</td><td rowspan="2" valign="top">add analytic metric</td><td>back 2</td><td>⬜ untested</td></tr>
<tr><td>broken 1</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to see statistics<br>(group by warehouse · ready stock · 20 units ready)</td><td rowspan="1" valign="top">add analytic metric</td><td>20 units ready with their value</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to see statistics<br>(group daily · lost stock · opname finds 2 units lost today)</td><td rowspan="1" valign="top">add analytic metric</td><td>lost 2 with their value</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to see statistics<br>(group daily · lost stock · 1 unit adjusted as lost today)</td><td rowspan="1" valign="top">add analytic metric</td><td>lost 1 with its value</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">8</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to see statistics<br>(group daily · lost stock · 2 units lost yesterday · 1 found today)</td><td rowspan="1" valign="top">add analytic metric</td><td>yesterday still shows lost 2</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">9</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to see statistics<br>(group daily · restock · 1 restock created today)</td><td rowspan="1" valign="top">add analytic metric</td><td>restock created shown</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">10</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to see statistics<br>(group daily · restock · 1 restock edited today)</td><td rowspan="1" valign="top">add analytic metric</td><td>restock change shown</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">11</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to see statistics<br>(group daily · restock · 1 restock with COD today)</td><td rowspan="1" valign="top">add analytic metric</td><td>COD shown</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">12</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to see statistics<br>(group daily · restock · 1 restock marked lost today)</td><td rowspan="1" valign="top">add analytic metric</td><td>lost restock shown</td><td>🚧 unimplemented</td></tr>
</table>
