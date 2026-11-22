# Acceptance — analytic / report

The **Analitik** screen (`/analytic`): pick how the table is grouped, add metrics as its columns, narrow it by the
filters every chosen metric shares, sort it, read it as a table or a graph. The whole report lives in the link, so a
second tab is the compare view. A warehouse never sees a seller's money. Business:
[rpc_provide.md](../../business/analytic/rpc_provide.md) · rules: [guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">1</td><td rowspan="2" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to see statistics<br>(first open)</td><td rowspan="2" valign="top">open analytic</td><td>grouped by shop over the last 30 days</td><td>✅ ok</td></tr>
<tr><td>hint to add a metric shown</td><td>✅ ok</td></tr>
<tr><td rowspan="3" valign="top">2</td><td rowspan="3" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · orders created · ads expense)</td><td rowspan="3" valign="top">add analytic metric</td><td>each metric shown as its own column</td><td>✅ ok</td></tr>
<tr><td>one row per day</td><td>✅ ok</td></tr>
<tr><td>as-of date and time shown</td><td>✅ ok</td></tr>
<tr><td rowspan="2" valign="top">3</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · ads expense · one shop chosen · add expenses)</td><td rowspan="2" valign="top">add analytic metric</td><td>shop filter removed</td><td>✅ ok</td></tr>
<tr><td>message says expenses cannot be filtered by shop</td><td>✅ ok</td></tr>
<tr><td rowspan="2" valign="top">4</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(expenses on the table · group by shop)</td><td rowspan="2" valign="top">change analytic group</td><td>expenses removed</td><td>✅ ok</td></tr>
<tr><td>message says it cannot be grouped by shop</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(orders created by shop)</td><td rowspan="1" valign="top">sort analytic report</td><td>rows ordered by orders created</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(orders created · group daily)</td><td rowspan="1" valign="top">view analytic as graph</td><td>the same rows drawn as a graph</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(report built · link opened in another tab)</td><td rowspan="1" valign="top">open analytic link</td><td>the same report shown</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">8</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(range longer than a year)</td><td rowspan="1" valign="top">change analytic period</td><td>report not loaded, message says a year at most</td><td><a href="#an-analytic-range-over-a-year-keeps-the-last-windows-figures">❌ error</a></td></tr>
<tr><td rowspan="1" valign="top">9</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to see statistics<br>(group by seller · restock)</td><td rowspan="1" valign="top">add analytic metric</td><td>seller's money columns not shown</td><td>✅ ok</td></tr>
</table>

## Errors

### an-analytic-range-over-a-year-keeps-the-last-windows-figures

| | |
| --- | --- |
| then | `selling:all` wants to see statistics (range longer than a year) · change analytic period · report not loaded, message says a year at most |
| expected | after picking a range over a year, the report is not loaded: the line under the picker says a year at most, and no figure is on screen |
| actual | the line is right (*That range covers 401 days. A report reads at most 366 — pick a year at most.*) and no MetricSearch / MetricData read is sent, but the LAST window's report stays on screen under the new range: the headline (Orders created *6*), today's row of the table and the as-of line. The range button reads the new 401-day window, so the last 7 days' figures read as that window's |
| cause | the report read uses `listQuery` (`placeholderData: keepPreviousData`) and is `enabled: false` while the range is too long ([index.tsx](../../../frontend/src/pages/analytic/index.tsx#L126)); TanStack Query keeps the previous answer as placeholder for a DISABLED query too, and with nothing fetching the page draws no refresh overlay either — the same cause as settlement's [a-report-over-a-year-keeps-the-last-windows-figures](../settlement/report.md#a-report-over-a-year-keeps-the-last-windows-figures) |
| seen | the e2e run for owner, admin and cs (2026-11-22, [20261122-063000-acceptance-analytic-report.md](../../../e2e_report/tester/20261122-063000-acceptance-analytic-report.md)) |
| check | `selling:owner change analytic period` and the admin / cs tests of *selling:all wants to see statistics (range longer than a year)* in [analytic_wants_to_see_statistics.spec.ts](../../../frontend/e2e/analytic_wants_to_see_statistics.spec.ts), marked `test.fail` until this is fixed |
