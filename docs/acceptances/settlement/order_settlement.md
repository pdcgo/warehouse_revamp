# Acceptance — settlement / order_settlement

Every money row on one order — the sale, the payouts, the fees — read on **Penyelesaian › Daftar** and the order's
**Settlement** tab, added by hand with **Add Entry**, and corrected by a reversing row (a row is never edited). Business:
[context.md](../../business/settlement/context.md) · rules: [guide.md](../guide.md)

<table style="border-collapse: collapse; text-align: left;" border="1">
<tr><th>given</th><th>when</th><th>then</th><th>status</th></tr>
<tr><td rowspan="4" valign="top"><code>selling:all</code> wants to see what an order earned<br>(sale from order · payout from import · ads fee added manually)</td><td rowspan="4" valign="top">open order settlement</td><td>sale, payout and ads fee shown as rows</td><td>⬜ untested</td></tr>
<tr><td>sale shown as order</td><td>⬜ untested</td></tr>
<tr><td>payout shown as import</td><td>⬜ untested</td></tr>
<tr><td>ads fee shown as manual with who added it</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:all</code> wants to see what an order earned<br>(product with no recorded cost)</td><td rowspan="1" valign="top">open order settlement</td><td>no margin shown</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top"><code>selling:all</code> wants to see how the margin adds up<br>(total cost known · payout arrived)</td><td rowspan="3" valign="top">open margin breakdown</td><td>each type summed as a line</td><td>⬜ untested</td></tr>
<tr><td>true margin shown with its share of the sale</td><td>⬜ untested</td></tr>
<tr><td>deduction shown</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:all</code> wants to see how the margin adds up<br>(total cost known · no payout yet)</td><td rowspan="1" valign="top">open margin breakdown</td><td>no deduction shown</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:all</code> wants to record money on an order<br>(payout · reached us)</td><td rowspan="2" valign="top">add settlement entry</td><td>row added as manual with who added it</td><td>⬜ untested</td></tr>
<tr><td>order balance increases by the amount</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:all</code> wants to record money on an order<br>(ads fee · taken from us)</td><td rowspan="2" valign="top">add settlement entry</td><td>row added as manual</td><td>⬜ untested</td></tr>
<tr><td>order balance decreases by the amount</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:all</code> wants to record money on an order<br>(ads fee returned · reached us)</td><td rowspan="1" valign="top">add settlement entry</td><td>order balance increases by the amount</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:all</code> wants to record money on an order<br>(payout · submitted twice by double click)</td><td rowspan="1" valign="top">add settlement entry</td><td>recorded once</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:cs</code> wants to record a missing sale<br>(order with no estimate)</td><td rowspan="1" valign="top">add settlement entry</td><td>estimate recorded on the order</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:cs</code> wants to record a missing sale<br>(order already has an estimate)</td><td rowspan="1" valign="top">add settlement entry</td><td>cannot add a second estimate</td><td>⬜ untested</td></tr>
<tr><td rowspan="1" valign="top"><code>selling:owner</code> · <code>selling:cs</code> wants to fix a wrong estimate<br>(estimate reversed)</td><td rowspan="1" valign="top">add settlement entry</td><td>new estimate recorded on the order</td><td>⬜ untested</td></tr>
<tr><td rowspan="3" valign="top"><code>selling:all</code> wants to undo a wrong entry<br>(manual payout with wrong amount)</td><td rowspan="3" valign="top">reverse settlement entry</td><td>reversing row added</td><td>⬜ untested</td></tr>
<tr><td>original shown as reversed</td><td>⬜ untested</td></tr>
<tr><td>order balance back to before</td><td>⬜ untested</td></tr>
<tr><td rowspan="2" valign="top"><code>selling:all</code> wants to undo a wrong entry<br>(imported row on the wrong order)</td><td rowspan="2" valign="top">reverse settlement entry</td><td>reversing row added</td><td>⬜ untested</td></tr>
<tr><td>original shown as reversed</td><td>⬜ untested</td></tr>
</table>
