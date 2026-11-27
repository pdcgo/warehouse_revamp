# Acceptance — settlement / report

What the marketplace actually paid against what buyers paid, over time and by shop or person — **Penyelesaian ›
Laporan** (`/settlement/report`), for the owner and admin of a selling team. Read only. The window is the day a row was
learned, and every figure is folded behind the scenes, so a new entry can take a moment to appear. Business:
[analytic_context.md](../../business/settlement/analytic_context.md) · rules: [guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="5" valign="top">1</td><td rowspan="5" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to see how much of the sales reached us<br>(sales Rp 1.000.000 · received Rp 900.000 · withdrawn Rp 500.000)</td><td rowspan="5" valign="top">open settlement report</td><td>sales, received and withdrawn shown</td><td>✅ ok</td></tr>
<tr><td>gap Rp 100.000 and take rate 10%</td><td>✅ ok</td></tr>
<tr><td>withdrawal counted in position, not in received</td><td>✅ ok</td></tr>
<tr><td>each day shown as a row over time</td><td>✅ ok</td></tr>
<tr><td>as-of date and time shown</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to see how much of the sales reached us<br>(1 order cancelled)</td><td rowspan="1" valign="top">open settlement report</td><td>cancelled order not counted in sales</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to compare periods<br>(month · 3 months)</td><td rowspan="1" valign="top">change report period</td><td>3 rows, one per month</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to compare periods<br>(range longer than a year)</td><td rowspan="1" valign="top">change report period</td><td>report not loaded, message says a year at most</td><td>✅ ok</td></tr>
<tr><td rowspan="2" valign="top">5</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to know who carries the gap<br>(orders by Ani and Budi · imported shop row)</td><td rowspan="2" valign="top">group report by person</td><td>each person's position shown, largest first</td><td>✅ ok</td></tr>
<tr><td>imported shop row counted to the shop's primary CS</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to know who carries the gap<br>(imported shop row · shop has no primary CS)</td><td rowspan="1" valign="top">group report by person</td><td>not listed by person, still counted in the summary</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to check a shop's entries<br>(by shop · last month)</td><td rowspan="1" valign="top">open shop entries from report</td><td>shop entries opened on that shop and last month</td><td>✅ ok</td></tr>
</table>
