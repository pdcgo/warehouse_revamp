# Acceptance — analytic / report

The **Analitik** screen (`/analytic`): pick how the table is grouped, add metrics as its columns, narrow it by the
filters every chosen metric shares, sort it, read it as a table or a graph. The whole report lives in the link, so a
second tab is the compare view. A warehouse never sees a seller's money. Business:
[rpc_provide.md](../../business/analytic/rpc_provide.md) · rules: [guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">1</td><td rowspan="2" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to see statistics<br>(first open)</td><td rowspan="2" valign="top">open analytic</td><td>grouped by shop over the last 30 days</td><td>⬜ untested</td></tr>
<tr><td>hint to add a metric shown</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">2</td><td rowspan="3" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · orders created · ads expense)</td><td rowspan="3" valign="top">add analytic metric</td><td>each metric shown as its own column</td><td>⬜ untested</td></tr>
<tr><td>one row per day</td><td>⬜ untested</td></tr>
<tr><td>as-of date and time shown</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">3</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · ads expense · one shop chosen · add expenses)</td><td rowspan="2" valign="top">add analytic metric</td><td>shop filter removed</td><td>⬜ untested</td></tr>
<tr><td>message says expenses cannot be filtered by shop</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">4</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(expenses on the table · group by shop)</td><td rowspan="2" valign="top">change analytic group</td><td>expenses removed</td><td>⬜ untested</td></tr>
<tr><td>message says it cannot be grouped by shop</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(orders created by shop)</td><td rowspan="1" valign="top">sort analytic report</td><td>rows ordered by orders created</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(orders created · group daily)</td><td rowspan="1" valign="top">view analytic as graph</td><td>the same rows drawn as a graph</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(report built · link opened in another tab)</td><td rowspan="1" valign="top">open analytic link</td><td>the same report shown</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">8</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(range longer than a year)</td><td rowspan="1" valign="top">change analytic period</td><td>report not loaded, message says a year at most</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">9</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to see statistics<br>(group by seller · restock)</td><td rowspan="1" valign="top">add analytic metric</td><td>seller's money columns not shown</td><td>⬜ untested</td></tr>
</table>
