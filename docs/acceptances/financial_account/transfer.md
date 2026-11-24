# Acceptance — financial_account / transfer

**Transfer** moves money between two of the team's own accounts: one act, a `transfer` row out of one and a `transfer`
row into the other, on the day the money moved — never a day after today. Going below zero is warned, never refused.
The *To* picker offers only the team's active accounts, never an unknown one; an unknown account is only ever
transferred out of. A selling owner and admin, and a warehouse **owner**, move money; a warehouse admin keeps the
accounts but does not. Business: [context_decision.md](../../business/financial_account/context_decision.md) · rules:
[guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="4" valign="top">1</td><td rowspan="4" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> wants to move money between accounts<br>(active bank BCA Rp 1.000.000 · active wallet ShopeePay Rp 0 · Rp 200.000 from BCA to ShopeePay · today · note "ShopeePay top-up")</td><td rowspan="4" valign="top">transfer</td><td>BCA Rp 800.000, ShopeePay Rp 200.000</td><td>⬜ untested</td></tr>
<tr><td>a transfer row in each account, with the note</td><td>⬜ untested</td></tr>
<tr><td>total balance unchanged</td><td>⬜ untested</td></tr>
<tr><td>recorded in finance analytic metric</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">2</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> wants to move money between accounts<br>(active bank BCA Rp 100.000 · active wallet ShopeePay · Rp 300.000 from BCA to ShopeePay)</td><td rowspan="2" valign="top">transfer</td><td>warned before saving that BCA will be below zero</td><td>⬜ untested</td></tr>
<tr><td>saved, BCA −Rp 200.000 marked below zero</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> wants to move money between accounts<br>(active bank BCA · active wallet ShopeePay · from BCA to ShopeePay · money moved yesterday)</td><td rowspan="1" valign="top">transfer</td><td>both rows on yesterday's date</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> wants to move money between accounts<br>(active bank BCA · active wallet ShopeePay · from BCA to ShopeePay · day tomorrow)</td><td rowspan="1" valign="top">transfer</td><td>cannot pick a day after today</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">5</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> wants to move money between accounts<br>(active bank BCA · active wallet ShopeePay · from BCA to ShopeePay · amount Rp 0)</td><td rowspan="1" valign="top">transfer</td><td>cannot transfer</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">6</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> wants to move money between accounts<br>(transfer from active bank BCA · wallet ShopeePay already archived)</td><td rowspan="1" valign="top">transfer</td><td>ShopeePay cannot be picked as the account to transfer to</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> wants to move money between accounts<br>(transfer from active bank BCA · an unknown account made by shop Melati's withdrawal)</td><td rowspan="1" valign="top">transfer</td><td>the unknown account cannot be picked as the account to transfer to</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top">8</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> wants to move a withdrawal into its real account<br>(unknown account Rp 300.000 from shop Melati · active bank BCA TikTok · from the unknown account to BCA TikTok)</td><td rowspan="2" valign="top">transfer out</td><td>unknown account Rp 0</td><td>⬜ untested</td></tr>
<tr><td>BCA TikTok +Rp 300.000</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">9</td><td rowspan="1" valign="top"><code>warehouse:admin</code> wants to move money between accounts<br>(active bank BCA Rp 1.000.000)</td><td rowspan="1" valign="top">transfer</td><td>no Transfer button on the account, Match Balance still there</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">10</td><td rowspan="1" valign="top"><code>selling:cs</code> · <code>warehouse:staff</code> wants to move money between accounts<br>(active bank BCA Rp 1.000.000)</td><td rowspan="1" valign="top">transfer</td><td>no Transfer button on the account</td><td>⬜ untested</td></tr>
</table>
