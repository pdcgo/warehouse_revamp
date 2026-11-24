# Acceptance — financial_account / report

The **Account Report** (*Laporan Akun*, `/financial-accounts/report`): what moved the team's money over a period, the
last 1 month at first — five cards (opening balance, net change, closing balance, and the account and the provider that
moved most) and one row per period, every change type a column; a second view, *Breakdown*, by provider and account and
by type. Each column is filled by whatever posts that type, and some are filled from another page: an ads expense has its
own column apart from expense, a prive typed on expense lands in capital, a shipping cost in expense. A row counts on the
day the money moved, and the report is always up to date with the balances. Every member reads it and can export it.
Business: [context_decision.md](../../business/financial_account/context_decision.md) · rules: [guide.md](../guide.md)

## open

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="8" valign="top">1</td><td rowspan="8" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to know what moved the money<br>(active bank BCA · active wallet ShopeePay · in the last 1 month: withdrawal into BCA · expense from BCA · transfer from BCA to ShopeePay · BCA moved most)</td><td rowspan="8" valign="top">open account report</td><td>opens on the last 1 month, by day</td><td>⬜ untested</td></tr>
<tr><td>opening balance, at the start of the first day</td><td>⬜ untested</td></tr>
<tr><td>net change, with its share of the opening balance</td><td>⬜ untested</td></tr>
<tr><td>closing balance, said to be opening balance + net change</td><td>⬜ untested</td></tr>
<tr><td>account card: BCA, biggest of 2 accounts</td><td>⬜ untested</td></tr>
<tr><td>provider card: BCA, biggest of 2 providers</td><td>⬜ untested</td></tr>
<tr><td>one row per day with its closing balance, quiet days included, newest first</td><td>⬜ untested</td></tr>
<tr><td>transfer nets to zero for the team</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to know what moved the money<br>(active bank BCA · expense from BCA recorded just now)</td><td rowspan="1" valign="top">open account report</td><td>the expense shows at once in today's row</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to know what moved the money<br>(active bank BCA · active wallet ShopeePay · transfer created today · money moved yesterday)</td><td rowspan="1" valign="top">open account report</td><td>the transfer counted in yesterday's row</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to know what moved the money<br>(archived bank BCA · it moved in the last 1 month)</td><td rowspan="1" valign="top">open account report</td><td>BCA still counted, and offered in the account filter</td><td>⬜ untested</td></tr>
</table>

## columns

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to know what moved the money<br>(from <a href="account.md#set-up">create account</a> · bank BCA · opening balance)</td><td rowspan="1" valign="top">open account report</td><td>counted in the opening balance column</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to know what moved the money<br>(from <a href="reconcile.md">match balance</a> · active bank BCA · a difference found)</td><td rowspan="1" valign="top">open account report</td><td>counted in the adjustment column</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to know what moved the money<br>(from <a href="capital.md#add">add capital</a> · active bank BCA)</td><td rowspan="1" valign="top">open account report</td><td>counted in the capital column</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">8</td><td rowspan="1" valign="top"><code>selling:all</code> wants to know what moved the money<br>(from <a href="expense.md#record">record expense</a> · prive · taken from active bank BCA)</td><td rowspan="1" valign="top">open account report</td><td>counted in the capital column, not in expense</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">9</td><td rowspan="1" valign="top"><code>selling:all</code> wants to know what moved the money<br>(from <a href="../settlement/settlement_importer.md">import settlement</a> · shop Melati withdraws into active bank BCA)</td><td rowspan="1" valign="top">open account report</td><td>counted in the withdrawal column</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">10</td><td rowspan="1" valign="top"><code>selling:all</code> wants to know what moved the money<br>(from <a href="../inventory/restock.md#create">create restock</a> · paid from active bank BCA)</td><td rowspan="1" valign="top">open account report</td><td>counted in the restock column, as money out</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">11</td><td rowspan="1" valign="top"><code>selling:all</code> wants to know what moved the money<br>(from <a href="../inventory/restock.md#cancel-and-lost">cancel restock</a> · paid from active bank BCA · money returned)</td><td rowspan="1" valign="top">open account report</td><td>counted in the restock column, as money in</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">12</td><td rowspan="1" valign="top"><code>selling:all</code> wants to know what moved the money<br>(from <a href="expense.md#record">record expense</a> · electricity · paid from active bank BCA)</td><td rowspan="1" valign="top">open account report</td><td>counted in the expense column, as money out</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">13</td><td rowspan="1" valign="top"><code>selling:all</code> wants to know what moved the money<br>(from create warehouse transfer · shipping paid from active bank BCA)</td><td rowspan="1" valign="top">open account report</td><td>counted in the expense column</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">14</td><td rowspan="1" valign="top"><code>selling:all</code> wants to know what moved the money<br>(from create custom shipment · courier paid by the shop from active bank BCA)</td><td rowspan="1" valign="top">open account report</td><td>counted in the expense column</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">15</td><td rowspan="1" valign="top"><code>selling:all</code> wants to know what moved the money<br>(from <a href="expense.md#record">record expense</a> · marketplace ads · paid from active bank BCA)</td><td rowspan="1" valign="top">open account report</td><td>counted in the ads column, not in expense</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">16</td><td rowspan="1" valign="top"><code>selling:all</code> wants to know what moved the money<br>(from <a href="expense.md#record">record expense</a> · other money in · into active bank BCA)</td><td rowspan="1" valign="top">open account report</td><td>counted in the money in column</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">17</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to know what moved the money<br>(from <a href="../balance/payment.md">confirm payment</a> · the selling team pays the warehouse from BCA · accepted into the warehouse's account)</td><td rowspan="1" valign="top">open account report</td><td>counted in the team payment column, out for the selling team and in for the warehouse</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">18</td><td rowspan="1" valign="top"><code>selling:all</code> wants to know what moved the money<br>(from <a href="account.md#set-up">set account</a> · unknown account Rp 300.000 from shop Melati · BCA TikTok already registered · moved into BCA TikTok)</td><td rowspan="1" valign="top">open account report</td><td>counted in the transfer column, out of the unknown account and into BCA TikTok</td><td>⬜ untested</td></tr>
</table>

## periods

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="1" valign="top">19</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to compare periods<br>(active bank BCA · moved 2 months ago and today · period changed to last 3 months)</td><td rowspan="1" valign="top">change report period</td><td>the move of 2 months ago now in the cards and the rows</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">20</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to compare periods<br>(period longer than a year)</td><td rowspan="1" valign="top">change report period</td><td>report not loaded, message says a year at most</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">21</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to compare periods<br>(period 3 months · monthly)</td><td rowspan="1" valign="top">group report by month</td><td>3 rows, one per month</td><td>⬜ untested</td></tr>
</table>

## account

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top">22</td><td rowspan="3" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to see one account's money<br>(active bank BCA · active wallet ShopeePay · transfer from BCA to ShopeePay · BCA picked)</td><td rowspan="3" valign="top">filter report by account</td><td>opening balance, net change and closing balance are BCA's alone</td><td>⬜ untested</td></tr>
<tr><td>account and provider cards gone</td><td>⬜ untested</td></tr>
<tr><td>rows hold only BCA's movements, the transfer out included</td><td>⬜ untested</td></tr>
</table>

## detail

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">23</td><td rowspan="2" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to see what the change is made of<br>(active bank BCA · active wallet ShopeePay · in the last 1 month: withdrawal, expense and transfer)</td><td rowspan="2" valign="top">open change detail</td><td>each type that moved, money in first then money out, the largest first</td><td>⬜ untested</td></tr>
<tr><td>ends with opening balance + net change = closing balance</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">24</td><td rowspan="2" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to see what the change is made of<br>(active bank BCA · active wallet ShopeePay · both moved in the last 1 month)</td><td rowspan="2" valign="top">open account movers</td><td>every account ranked by its change, with opening, change and closing</td><td>⬜ untested</td></tr>
<tr><td>an account opens its page when clicked</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">25</td><td rowspan="2" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to see what the change is made of<br>(active bank BCA · active wallet ShopeePay · in the last 1 month: withdrawal, expense and transfer)</td><td rowspan="2" valign="top">open report breakdown</td><td>balance by provider and account, each account under its provider, with a total row</td><td>⬜ untested</td></tr>
<tr><td>movements by type, from opening balance to closing balance</td><td>⬜ untested</td></tr>
</table>

## export

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="1" valign="top">26</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to keep the report as a file<br>(periods view · monthly · BCA picked)</td><td rowspan="1" valign="top">export account report</td><td>xlsx of every period at the grain on screen, quiet ones included, BCA only</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">27</td><td rowspan="1" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to keep the report as a file<br>(breakdown view)</td><td rowspan="1" valign="top">export account report</td><td>one sheet each: per account, per provider and per type</td><td>⬜ untested</td></tr>
</table>
