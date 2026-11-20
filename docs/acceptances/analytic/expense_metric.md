# Acceptance — analytic / expense_metric

The three expense metrics on **Analitik** — *Biaya* (one column per typed kind and their total, never the stock loss),
*Biaya iklan* (which can be read per shop) and *Biaya gudang* (the warehouse fee frozen on each order, less the cancelled
ones, read by the warehouse too). A correction counts on the day it is made — unlike the Pengeluaran screen, which puts
it on the expense's own day. 🚧 is the coming types of [expense](../financial_account/expense.md), one given per type
under the same id. Business:
[rpc_provide_decision.md](../../business/analytic/rpc_provide_decision.md#expense-has-ads-and-expenses) · rules:
[guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">1</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · ads Rp 2.000.000 · payroll Rp 5.000.000 · operational Rp 1.000.000 · other Rp 500.000 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>each kind in its own column</td><td>⬜ untested</td></tr>
<tr><td>total Rp 8.500.000</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(group by shop · ads expense · ads for 2 shops)</td><td rowspan="1" valign="top">add analytic metric</td><td>each shop's ads expense shown</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · expense of 31 Oct reduced on 5 Nov)</td><td rowspan="1" valign="top">add analytic metric</td><td>correction counted on 5 Nov, not 31 Oct</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · stock written off today)</td><td rowspan="1" valign="top">add analytic metric</td><td>stock loss not counted</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to see statistics<br>(group daily · warehouse fee · 2 orders with a fee today · 1 cancelled)</td><td rowspan="1" valign="top">add analytic metric</td><td>1 fee transaction with its amount</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">6</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · adjustment Rp 50.000 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>adjustment shown</td><td>🚧 unimplemented</td></tr>
<tr><td>total up by Rp 50.000</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">7</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · bank fee Rp 6.500 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>bank fee shown</td><td>🚧 unimplemented</td></tr>
<tr><td>total up by Rp 6.500</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">8</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · content Rp 500.000 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>content shown</td><td>🚧 unimplemented</td></tr>
<tr><td>total up by Rp 500.000</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">9</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · tools Rp 2.000.000 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>tools shown</td><td>🚧 unimplemented</td></tr>
<tr><td>total up by Rp 2.000.000</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">10</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · equipment Rp 1.500.000 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>equipment shown</td><td>🚧 unimplemented</td></tr>
<tr><td>total up by Rp 1.500.000</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">11</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · electricity Rp 300.000 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>electricity shown</td><td>🚧 unimplemented</td></tr>
<tr><td>total up by Rp 300.000</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">12</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · kitchen Rp 200.000 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>kitchen shown</td><td>🚧 unimplemented</td></tr>
<tr><td>total up by Rp 200.000</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">13</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · internet Rp 350.000 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>internet shown</td><td>🚧 unimplemented</td></tr>
<tr><td>total up by Rp 350.000</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">14</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · basic salary Rp 4.000.000 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>basic salary shown</td><td>🚧 unimplemented</td></tr>
<tr><td>total up by Rp 4.000.000</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">15</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · bonus Rp 1.000.000 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>bonus shown</td><td>🚧 unimplemented</td></tr>
<tr><td>total up by Rp 1.000.000</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">16</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · contributions Rp 150.000 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>contributions shown</td><td>🚧 unimplemented</td></tr>
<tr><td>total up by Rp 150.000</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">17</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · outside debt paid Rp 1.000.000 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>outside debt shown</td><td>🚧 unimplemented</td></tr>
<tr><td>total up by Rp 1.000.000</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">18</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · prive Rp 2.000.000 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>prive shown</td><td>🚧 unimplemented</td></tr>
<tr><td>total up by Rp 2.000.000</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">19</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · deposit Rp 1.000.000 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>deposit shown</td><td>🚧 unimplemented</td></tr>
<tr><td>total down by Rp 1.000.000</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">20</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · other money out Rp 100.000 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>other shown</td><td>🚧 unimplemented</td></tr>
<tr><td>total up by Rp 100.000</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">21</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · other money in Rp 100.000 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>other shown</td><td>🚧 unimplemented</td></tr>
<tr><td>total down by Rp 100.000</td><td>🚧 unimplemented</td></tr>
<tr><td rowspan="2" valign="top">22</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(group daily · expenses · outside receivable received Rp 500.000 today)</td><td rowspan="2" valign="top">add analytic metric</td><td>outside receivable shown</td><td>🚧 unimplemented</td></tr>
<tr><td>total down by Rp 500.000</td><td>🚧 unimplemented</td></tr>
</table>
