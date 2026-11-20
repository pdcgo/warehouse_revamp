# Acceptance — balance / position

Reading the **Kewajiban** screens: the list (`/liability`) — one row per team, what this team owes it (payable) and what
it owes this team (receivable), the summary cards over every team — and one team's page (`/liability/:id`) with its net
position and its history. Only an owner and an admin see them. Paying, accepting, rejecting and telling to pay are
[payment](payment.md); the limit and its warning are [credit_limit](credit_limit.md). Rules: [guide.md](../guide.md)

## list

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top">1</td><td rowspan="3" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to see what is owed<br>(owes warehouse A Rp 300.000 · selling team B owes us Rp 100.000)</td><td rowspan="3" valign="top">open liability</td><td>total payable Rp 300.000</td><td>⬜ untested</td></tr>
<tr><td>total receivable Rp 100.000</td><td>⬜ untested</td></tr>
<tr><td>A under payable, B under receivable</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">2</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to see what is owed<br>(oldest unsettled entry 30 days old)</td><td rowspan="2" valign="top">open liability</td><td>oldest unsettled 30 days, in red</td><td>⬜ untested</td></tr>
<tr><td>the team it belongs to named under it</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to see what is owed<br>(1 payment awaiting our confirmation)</td><td rowspan="1" valign="top">open liability</td><td>awaiting your confirmation 1</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to see what is owed<br>(warehouse asked us to pay)</td><td rowspan="1" valign="top">open liability</td><td>"asks you to pay" on its row</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to see what is owed<br>(we set a limit of Rp 0 on selling team B)</td><td rowspan="1" valign="top">open liability</td><td>B's row marked frozen, next order refused</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>selling:cs</code> · <code>warehouse:staff</code> wants to see what is owed<br>(team owes another team)</td><td rowspan="1" valign="top">open liability</td><td>cannot see liability</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to see what is owed<br>(2 teams · search "Melati")</td><td rowspan="1" valign="top">filter liability</td><td>only Melati listed</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">8</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to see what is owed<br>(warehouse and selling teams · team type warehouse)</td><td rowspan="1" valign="top">filter liability</td><td>only warehouse teams listed</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">9</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to see what is owed<br>(2 teams · 1 with a payment awaiting · awaiting my confirmation)</td><td rowspan="1" valign="top">filter liability</td><td>only that team listed</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">10</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to see what is owed<br>(1 team square · unsettled only off)</td><td rowspan="1" valign="top">filter liability</td><td>square team listed as square</td><td>⬜ untested</td></tr>
</table>

## pair

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="2" valign="top">11</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to see what is owed<br>(owes warehouse A Rp 300.000)</td><td rowspan="2" valign="top">open liability pair</td><td>net position Rp 300.000, "you owe them"</td><td>⬜ untested</td></tr>
<tr><td>payable Rp 300.000</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">12</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to see what is owed<br>(order fee Rp 5.000 · payment Rp 300.000 accepted)</td><td rowspan="2" valign="top">open liability pair</td><td>each entry with what caused it, who recorded it and its amount</td><td>⬜ untested</td></tr>
<tr><td>balance after runs row to row</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">13</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to see what is owed<br>(order fee reversed after a cancel)</td><td rowspan="1" valign="top">open liability pair</td><td>reversal labelled</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">14</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to see what is owed<br>(entries both ways · receivable tab)</td><td rowspan="1" valign="top">filter liability history</td><td>only what they owe us listed</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">15</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants to see what is owed<br>(entries in Oct and Nov · 1–7 Nov)</td><td rowspan="2" valign="top">filter liability history</td><td>only that week's entries</td><td>⬜ untested</td></tr>
<tr><td>net position still the whole pair's</td><td>⬜ untested</td></tr>
</table>
