# Acceptance — financial_account / reconcile

**Cocokkan Saldo** (*Match Balance*) checks an account's books against the bank: the person types what the bank app
shows — or what a cash box counts — and the system works out the difference and posts it as an `adjustment`, the only
way an adjustment is ever made. Agreeing books post nothing and still mark the account checked; a difference needs a
reason. An unknown account has no statement to read and is not matched. An owner and an admin match — a warehouse
admin too. Business: [adjustment-is-for-reconciling-only](../../business/financial_account/context_decision.md#adjustment-is-for-reconciling-only)
· rules: [guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>id</th><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="3" valign="top">1</td><td rowspan="3" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants the books to match the bank<br>(active bank BCA · books Rp 1.000.000 · bank app shows Rp 1.000.000)</td><td rowspan="3" valign="top">match balance</td><td>says the books agree</td><td>✅ ok</td></tr>
<tr><td>nothing posted</td><td>✅ ok</td></tr>
<tr><td>last checked today</td><td>✅ ok</td></tr>
<tr><td rowspan="4" valign="top">2</td><td rowspan="4" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants the books to match the bank<br>(active bank BCA · books Rp 1.000.000 · bank app shows Rp 990.000 · reason "bank fee")</td><td rowspan="4" valign="top">match balance</td><td>difference −Rp 10.000 shown before saving</td><td>✅ ok</td></tr>
<tr><td>adjustment −Rp 10.000 posted with the reason</td><td>✅ ok</td></tr>
<tr><td>BCA Rp 990.000, last checked today</td><td>✅ ok</td></tr>
<tr><td>recorded in finance analytic metric</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">3</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants the books to match the bank<br>(active bank BCA · books Rp 1.000.000 · bank app shows Rp 1.050.000 · reason "transfer in not recorded")</td><td rowspan="1" valign="top">match balance</td><td>adjustment +Rp 50.000, BCA Rp 1.050.000</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">4</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants the books to match the bank<br>(active bank BCA · books Rp 1.000.000 · bank app shows Rp 990.000 · no reason)</td><td rowspan="1" valign="top">match balance</td><td>cannot match, says a reason is needed</td><td>✅ ok</td></tr>
<tr><td rowspan="2" valign="top">5</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants the books to match the bank<br>(active cash · books Rp 500.000 · box counts Rp 480.000 · reason "change given out")</td><td rowspan="2" valign="top">match balance</td><td>asks what the box counts, not the bank</td><td>✅ ok</td></tr>
<tr><td>adjustment −Rp 20.000</td><td>✅ ok</td></tr>
<tr><td rowspan="2" valign="top">6</td><td rowspan="2" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants the books to match the bank<br>(active bank BCA below zero · books −Rp 50.000 · bank app shows Rp 0 · reason "top-up recorded late")</td><td rowspan="2" valign="top">match balance</td><td>adjustment +Rp 50.000</td><td>✅ ok</td></tr>
<tr><td>"below zero" gone from its row</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">7</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants the books to match the bank<br>(active bank BCA · bank app read on 3 Nov · a difference)</td><td rowspan="1" valign="top">match balance</td><td>the adjustment row on 3 Nov</td><td>✅ ok</td></tr>
<tr><td rowspan="1" valign="top">8</td><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:admin</code> · <code>warehouse:owner</code> · <code>warehouse:admin</code> wants the books to match the bank<br>(unknown account holding Rp 300.000 withdrawn by shop Melati · its bank not named yet)</td><td rowspan="1" valign="top">match balance</td><td>no Match Balance on the unknown account, only Set Account, Transfer Out and Archive</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top">9</td><td rowspan="1" valign="top"><code>selling:cs</code> · <code>warehouse:staff</code> wants the books to match the bank<br>(active bank BCA)</td><td rowspan="1" valign="top">match balance</td><td>no Match Balance button on the account</td><td>✅ ok</td></tr>
</table>
