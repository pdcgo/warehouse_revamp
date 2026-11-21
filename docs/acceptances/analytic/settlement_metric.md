# Acceptance — analytic / settlement_metric

The two settlement metrics on **Analitik** — *Penyelesaian* (sales, received, withdrawn, gap, take rate, position to
date) and *Penyelesaian per jenis* (one column per settlement type) — read by a selling team only. They are the figures
[the settlement report](../settlement/report.md) shows, so the two screens agree. Business:
[analytic_context.md](../../business/settlement/analytic_context.md) · rules: [guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">1</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(<b>group: daily</b> · add <b>type: settlement</b> · sale Rp 1.000.000 · payout Rp 900.000)</td><td rowspan="2" valign="top">add analytic metric</td><td>sales, received, gap and take rate shown on the day learned</td><td>⬜ untested</td></tr>
<tr><td>figures match the settlement report for the same dates</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(<b>group: shop</b> · add <b>type: settlement</b> · 2 shops)</td><td rowspan="1" valign="top">add analytic metric</td><td>each shop's position shown</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(<b>group: daily</b> · add <b>type: settlement per type</b> · payout and ads fee on one order)</td><td rowspan="1" valign="top">add analytic metric</td><td>payout and ads fee shown in their own columns</td><td>⬜ untested</td></tr>
</table>
