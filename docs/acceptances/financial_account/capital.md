# Acceptance — financial_account / capital

**Add / Withdraw Capital** (*Setor / Tarik Modal*) records the business owner's own money, put into a team or taken out:
one `capital` row on the account, signed by the direction picked, never read as revenue, an expense or an adjustment. On
a selling team's account the same act is the deposit or prive on expense — one record shown on both pages, never in its
spending; a warehouse team has no expense page. Only an active account takes it, never an unknown one. A selling owner
and admin, and a warehouse **owner**, add and withdraw capital; a warehouse admin keeps the accounts but does not.
Business: [capital-joins-the-types](../../business/financial_account/context_decision.md#capital-joins-the-types) ·
[prive-and-deposit-on-pengeluaran-are-the-accounts-capital](../../business/financial_account/context_decision.md#prive-and-deposit-on-pengeluaran-are-the-accounts-capital)
· rules: [guide.md](../guide.md)

## add

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="7" valign="top">1</td><td rowspan="7" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to record the owner's capital<br>(active bank BCA Rp 1.000.000 · add Rp 20.000.000 · today · note "first capital")</td><td rowspan="7" valign="top">add capital</td><td>BCA Rp 21.000.000</td><td>⬜ untested</td></tr>
<tr><td>a capital row in BCA, with the note</td><td>⬜ untested</td></tr>
<tr><td>recorded on expense as <i>deposit · owner adds capital</i>, marked <i>recorded on the account page</i></td><td>⬜ untested</td></tr>
<tr><td>deposit and month total on expense decrease</td><td>⬜ untested</td></tr>
<tr><td>spending on expense unchanged</td><td>⬜ untested</td></tr>
<tr><td>recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td>recorded in expense analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">2</td><td rowspan="3" valign="top"><code>warehouse:owner</code> wants to record the owner's capital<br>(active bank BCA Rp 1.000.000 · add Rp 20.000.000 · today · note "first capital")</td><td rowspan="3" valign="top">add capital</td><td>BCA Rp 21.000.000</td><td>⬜ untested</td></tr>
<tr><td>a capital row in BCA, with the note</td><td>⬜ untested</td></tr>
<tr><td>recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> wants to record the owner's capital<br>(active bank BCA · add Rp 20.000.000 · money came in yesterday)</td><td rowspan="1" valign="top">add capital</td><td>the capital row on yesterday's date</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> wants to record the owner's capital<br>(active bank BCA · add Rp 20.000.000 · day tomorrow)</td><td rowspan="1" valign="top">add capital</td><td>cannot pick a day after today</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> wants to record the owner's capital<br>(active bank BCA · amount Rp 0)</td><td rowspan="1" valign="top">add capital</td><td>cannot add capital</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> wants to record the owner's capital<br>(unknown account holding Rp 300.000 withdrawn by shop Melati · its bank not named yet)</td><td rowspan="1" valign="top">add capital</td><td>no Add / Withdraw Capital on the unknown account, only Set Account, Transfer Out and Archive</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>warehouse:admin</code> wants to record the owner's capital<br>(active bank BCA Rp 1.000.000)</td><td rowspan="1" valign="top">add capital</td><td>no Add / Withdraw Capital in the account's menu, Match Balance still there</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">8</td><td rowspan="1" valign="top"><code>selling:cs</code> · <code>warehouse:staff</code> wants to record the owner's capital<br>(active bank BCA Rp 1.000.000)</td><td rowspan="1" valign="top">add capital</td><td>no Add / Withdraw Capital on the account</td><td>⬜ untested</td></tr>
</table>

## withdraw

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="7" valign="top">9</td><td rowspan="7" valign="top"><code>selling:owner</code> · <code>selling:admin</code> wants to record the owner's capital<br>(active bank BCA Rp 5.000.000 · withdraw Rp 2.000.000 · today · note "prive November")</td><td rowspan="7" valign="top">withdraw capital</td><td>BCA Rp 3.000.000</td><td>⬜ untested</td></tr>
<tr><td>a capital row out of BCA, with the note</td><td>⬜ untested</td></tr>
<tr><td>recorded on expense as <i>prive · owner takes capital</i>, marked <i>recorded on the account page</i></td><td>⬜ untested</td></tr>
<tr><td>prive and month total on expense increase</td><td>⬜ untested</td></tr>
<tr><td>spending on expense unchanged</td><td>⬜ untested</td></tr>
<tr><td>recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td>recorded in expense analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top">10</td><td rowspan="3" valign="top"><code>warehouse:owner</code> wants to record the owner's capital<br>(active bank BCA Rp 5.000.000 · withdraw Rp 2.000.000 · today · note "prive November")</td><td rowspan="3" valign="top">withdraw capital</td><td>BCA Rp 3.000.000</td><td>⬜ untested</td></tr>
<tr><td>a capital row out of BCA, with the note</td><td>⬜ untested</td></tr>
<tr><td>recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">11</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> wants to record the owner's capital<br>(active bank BCA Rp 1.000.000 · withdraw Rp 1.500.000)</td><td rowspan="2" valign="top">withdraw capital</td><td>warned before saving that BCA will be below zero</td><td>⬜ untested</td></tr>
<tr><td>saved, BCA −Rp 500.000 marked below zero</td><td>⬜ untested</td></tr>
</table>
