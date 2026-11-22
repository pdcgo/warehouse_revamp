# Acceptance — analytic / finance_metric

The two finance metrics on **Analitik** — *Account changes* (the opening balance, one column per change type, the net
change and the closing balance) and *Change types* (the same money, one row per type). Money in is positive, money out is
negative, and every team reads only its own accounts, a warehouse included. The action that moves an account is checked
in its own feature too (*recorded in finance analytic metric*). Business:
[rpc_provide_decision.md](../../business/analytic/rpc_provide_decision.md#financial-accounts-serve-their-changes-and-their-types)
· rules: [guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">1</td><td rowspan="2" valign="top"><code>selling:all</code> · <code>warehouse:all</code> wants to see statistics<br>(<b>group: daily</b> · add <b>type: account changes</b> · opening Rp 1.000.000 · Rp 300.000 out today)</td><td rowspan="2" valign="top">add analytic metric</td><td>net change −Rp 300.000</td><td>✅ ok</td></tr>
<tr><td>closing balance Rp 700.000</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">2</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(<b>group: account</b> · add <b>type: account changes</b> · expense Rp 200.000 from bank)</td><td rowspan="1" valign="top">add analytic metric</td><td>expense −Rp 200.000 on bank</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(<b>group: account</b> · add <b>type: account changes</b> · ads expense Rp 150.000 from bank)</td><td rowspan="1" valign="top">add analytic metric</td><td>ads expense −Rp 150.000 on bank</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(<b>group: account</b> · add <b>type: account changes</b> · reconcile finds bank Rp 10.000 short)</td><td rowspan="1" valign="top">add analytic metric</td><td>adjustment −Rp 10.000 on bank</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(<b>group: account</b> · add <b>type: account changes</b> · withdrawal of Rp 1.000.000 imported)</td><td rowspan="1" valign="top">add analytic metric</td><td>withdrawal +Rp 1.000.000 on the shop's account</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(<b>group: account</b> · add <b>type: account changes</b> · restock Rp 300.000 paid from bank)</td><td rowspan="1" valign="top">add analytic metric</td><td>restock −Rp 300.000 on bank</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(<b>group: account</b> · add <b>type: account changes</b> · restock shipping cost raised Rp 50.000)</td><td rowspan="1" valign="top">add analytic metric</td><td>restock −Rp 50.000 on the edit day</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">8</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(<b>group: account</b> · add <b>type: account changes</b> · restock Rp 300.000 payment moved from bank A to bank B)</td><td rowspan="1" valign="top">add analytic metric</td><td>restock +Rp 300.000 on bank A, −Rp 300.000 on bank B</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">9</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(<b>group: account</b> · add <b>type: account changes</b> · restock Rp 300.000 cancelled)</td><td rowspan="1" valign="top">add analytic metric</td><td>restock +Rp 300.000 on the cancel day</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">10</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(<b>group: account</b> · add <b>type: account changes</b> · new account opened with Rp 1.000.000)</td><td rowspan="1" valign="top">add analytic metric</td><td>account opened +Rp 1.000.000</td><td>✅ ok</td></tr>
<tr><td rowspan="2" valign="top">11</td><td rowspan="2" valign="top"><code>selling:all</code> wants to see statistics<br>(<b>group: account</b> · add <b>type: account changes</b> · Rp 100.000 transferred from bank to ShopeePay)</td><td rowspan="2" valign="top">add analytic metric</td><td>transfer −Rp 100.000 on bank, +Rp 100.000 on ShopeePay</td><td>✅ ok</td></tr>
<tr><td>team's transfer total 0</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">12</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(<b>group: account</b> · add <b>type: account changes</b> · payment Rp 500.000 accepted by the warehouse)</td><td rowspan="1" valign="top">add analytic metric</td><td>team payment −Rp 500.000 on the paying account</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">13</td><td rowspan="1" valign="top"><code>warehouse:all</code> wants to see statistics<br>(<b>group: account</b> · add <b>type: account changes</b> · payment Rp 500.000 accepted)</td><td rowspan="1" valign="top">add analytic metric</td><td>team payment +Rp 500.000 on the receiving account</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">14</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(<b>group: account</b> · add <b>type: account changes</b> · owner adds capital Rp 2.000.000)</td><td rowspan="1" valign="top">add analytic metric</td><td>capital +Rp 2.000.000</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">15</td><td rowspan="1" valign="top"><code>selling:all</code> wants to see statistics<br>(<b>group: change type</b> · add <b>type: change types</b> · expense, restock and team payment this month)</td><td rowspan="1" valign="top">add analytic metric</td><td>one row per change type with its amount</td><td>✅ ok</td></tr>
</table>

> 📝 **Capital (id 14)** — capital is recorded on the account itself, while prive and deposit are coming as expense types
> ([expense](../financial_account/expense.md), ids 18–19). Which of the two records the owner's money is not settled here.
