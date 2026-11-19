# Acceptance — analytic / order_metric

The five order metrics on **Analitik** — orders created, cancelled, returns created, returns arrived, orders lost — each a
count, the orders' total cost and their marketplace total. A warehouse reads the count, never the seller's money. 🚧
rows are the status changes [order](../inventory/order.md) records *in analytic metric* while no metric reads them yet.
Business: [order_statistic_metric.md](../../business/order/order_statistic_metric.md) · rules: [guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top">1</td><td rowspan="3" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · orders created · 1 order today · total cost Rp 80.000 · MP Rp 120.000)</td><td rowspan="3" valign="top">add analytic metric</td><td>orders created 1 on today's row</td><td>⬜ untested</td></tr>
<tr><td>total created Rp 80.000</td><td>⬜ untested</td></tr>
<tr><td>MP total Rp 120.000</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · orders cancelled · 1 order cancelled today)</td><td rowspan="1" valign="top">add analytic metric</td><td>orders cancelled 1 with its totals</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · returns created · 1 return made today)</td><td rowspan="1" valign="top">add analytic metric</td><td>returns created 1 with its totals</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · returns arrived · 1 return arrived today)</td><td rowspan="1" valign="top">add analytic metric</td><td>returns arrived 1 with its totals</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · orders lost · 1 order marked lost today)</td><td rowspan="1" valign="top">add analytic metric</td><td>orders lost 1 with its totals</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">6</td><td rowspan="2" valign="top"><code>warehouse:all</code> wants to see statistics<br>(group daily · orders created · 1 order at this warehouse)</td><td rowspan="2" valign="top">add analytic metric</td><td>orders created 1</td><td>⬜ untested</td></tr>
<tr><td>totals not shown</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to see statistics<br>(group daily · orders confirmed · 1 order confirmed today)</td><td rowspan="1" valign="top">add analytic metric</td><td>orders confirmed shown</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">8</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to see statistics<br>(group daily · orders back to pending · 1 order back to pending today)</td><td rowspan="1" valign="top">add analytic metric</td><td>orders back to pending shown</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">9</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to see statistics<br>(group daily · orders picked · 1 order picked today)</td><td rowspan="1" valign="top">add analytic metric</td><td>orders picked shown</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">10</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to see statistics<br>(group daily · orders handed over · 1 order handed over today)</td><td rowspan="1" valign="top">add analytic metric</td><td>orders handed over shown</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">11</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · orders shipped · 1 order marked shipped today)</td><td rowspan="1" valign="top">add analytic metric</td><td>orders shipped shown</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">12</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · orders completed · 1 order completed today)</td><td rowspan="1" valign="top">add analytic metric</td><td>orders completed shown</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">13</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · orders with a problem · 1 order marked problem today)</td><td rowspan="1" valign="top">add analytic metric</td><td>orders with a problem shown</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="1" valign="top">14</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · disputes resolved · 1 dispute resolved today)</td><td rowspan="1" valign="top">add analytic metric</td><td>disputes resolved shown</td><td>🚧 unimplemented</td></tr>
</table>
